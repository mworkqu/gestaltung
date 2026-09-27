// The manual / CSV adapter (Task 19a): a supplier's price list as a CSV file,
// read through a column mapping the owner sets once per supplier. It covers
// Voltaat and Alibaba today and is the fallback for every other supplier.
// Pure — parsing happens in the browser, the server only applies the result.

import { parseCsv } from "@/lib/parts/sheet-import";
import type { Availability } from "@/lib/store/sourcing";
import type { AdapterRowError, SourcedOffer, SupplierAdapter } from "@/lib/sourcing/types";

export const csvAdapter: SupplierAdapter = { code: "csv", kind: "file" };

export const OFFER_FIELDS = [
  "supplierSku",
  "name",
  "cost",
  "retailPrice",
  "currency",
  "availability",
  "leadTimeDays",
  "packSize",
  "moq",
  "url",
  "ourSku",
  "category",
] as const;
export type OfferField = (typeof OFFER_FIELDS)[number];

/** Field → CSV header (exact header text as it appears in the file). */
export type ColumnMapping = Partial<Record<OfferField, string>>;

const NUMERIC: ReadonlySet<OfferField> = new Set(["cost", "retailPrice", "leadTimeDays", "packSize", "moq"]);

const GUESSES: Record<OfferField, RegExp> = {
  supplierSku: /^(supplier\s*)?(sku|part\s*(no|number|#)|item\s*(no|code|#)|product\s*(code|id)|mpn|code|model)$/i,
  name: /^(product\s*)?(name|title|description|item)$/i,
  cost: /^(unit\s*)?(cost|buy(ing)?\s*price|wholesale|dealer\s*price|net\s*price)$/i,
  retailPrice: /^(retail(\s*price)?|price|sale\s*price|selling\s*price|msrp|rrp)$/i,
  currency: /^(currency|curr|ccy)$/i,
  availability: /^(availability|stock(\s*status)?|in\s*stock|status)$/i,
  leadTimeDays: /^(lead\s*time(\s*\(?days\)?)?|lead\s*days|delivery\s*days|days)$/i,
  packSize: /^(pack(\s*size)?|pack\s*qty|pcs\s*per\s*pack|units?\s*per\s*pack)$/i,
  moq: /^(moq|min(imum)?\s*(order)?\s*(qty|quantity)?)$/i,
  url: /^(url|link|product\s*url|page)$/i,
  ourSku: /^(our\s*sku|gestaltung\s*sku|internal\s*sku)$/i,
  category: /^(category|type|group)$/i,
};

/** Best guess at a mapping from the file's headers; a saved mapping wins over it. */
export function guessMapping(headers: string[], saved?: ColumnMapping | null): ColumnMapping {
  const out: ColumnMapping = {};
  const used = new Set<string>();
  for (const f of OFFER_FIELDS) {
    const keep = saved?.[f];
    if (keep && headers.includes(keep)) {
      out[f] = keep;
      used.add(keep);
    }
  }
  for (const f of OFFER_FIELDS) {
    if (out[f]) continue;
    const h = headers.find((x) => !used.has(x) && GUESSES[f].test(x.trim().replace(/[*:]/g, "")));
    if (h) {
      out[f] = h;
      used.add(h);
    }
  }
  return out;
}

/** "QAR 1,250.50", "$3.20", "1 250,5" → number. Empty → null; junk → NaN. */
export function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return null;
  let t = s.replace(/[^\d.,-]/g, "");
  if (/,\d{1,2}$/.test(t) && !t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return t && Number.isFinite(n) ? n : NaN;
}

/** Words or a quantity → our availability. A quantity is never stored, only read. */
export function parseAvailability(raw: string): Availability | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  const qty = Number(s.replace(/[^\d.-]/g, ""));
  if (/^\d+(\.\d+)?$/.test(s)) return qty > 0 ? "in_stock" : "unavailable";
  if (/(back\s*order|pre-?order|on\s*order|incoming)/.test(s)) return "backorder";
  if (/(out\s*of\s*stock|sold\s*out|unavailable|discontinued|^no$|^false$|^0$)/.test(s)) return "unavailable";
  if (/(low|limited|few|last)/.test(s)) return "limited";
  if (/(in\s*stock|available|yes|true|ready)/.test(s)) return "in_stock";
  return "unknown";
}

export type CsvReadResult = {
  headers: string[];
  rows: string[][];
};

export function readCsv(text: string): CsvReadResult {
  const all = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim() !== ""));
  const [headers = [], ...rows] = all;
  return { headers: headers.map((h) => h.trim()), rows };
}

/** Applies a mapping to the rows. Rows without a supplier SKU are reported, not guessed. */
export function toOffers(
  csv: CsvReadResult,
  mapping: ColumnMapping
): { offers: SourcedOffer[]; errors: AdapterRowError[] } {
  const idx = (f: OfferField) => (mapping[f] ? csv.headers.indexOf(mapping[f]!) : -1);
  const cols = Object.fromEntries(OFFER_FIELDS.map((f) => [f, idx(f)])) as Record<OfferField, number>;
  const offers: SourcedOffer[] = [];
  const errors: AdapterRowError[] = [];
  const seen = new Set<string>();

  csv.rows.forEach((r, i) => {
    const rowNo = i + 2; // 1-based, after the header row
    const cell = (f: OfferField) => (cols[f] >= 0 ? (r[cols[f]] ?? "").trim() : "");
    const sku = cell("supplierSku");
    if (!sku) {
      errors.push({ row: rowNo, reason: "no_sku" });
      return;
    }
    const o: SourcedOffer = { supplierSku: sku };
    let bad = false;
    for (const f of NUMERIC) {
      if (cols[f] < 0) continue;
      const n = parseAmount(cell(f));
      if (Number.isNaN(n) || (n !== null && n < 0)) {
        errors.push({ row: rowNo, reason: "bad_number", field: f });
        bad = true;
        continue;
      }
      const v = n === null ? null : f === "cost" || f === "retailPrice" ? n : Math.max(f === "leadTimeDays" ? 0 : 1, Math.round(n));
      (o as Record<string, unknown>)[f] = v;
    }
    if (bad) return;
    if (cols.availability >= 0) o.availability = parseAvailability(cell("availability"));
    if (cols.currency >= 0) {
      const c = cell("currency").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
      o.currency = c.length === 3 ? c : null;
    }
    for (const f of ["name", "ourSku", "category", "url"] as const) {
      if (cols[f] >= 0) o[f] = cell(f) || null;
    }
    if (o.url && !/^https?:\/\//i.test(o.url)) o.url = null;

    const key = sku.toLowerCase();
    if (seen.has(key)) return; // first row wins for a repeated SKU
    seen.add(key);
    offers.push(o);
  });

  return { offers, errors };
}
