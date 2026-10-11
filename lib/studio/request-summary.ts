// W2 (2026-10-11): what the "Request received" page (/[locale]/projects/[id]/request)
// shows after "Get it made": the project in plain words and a rough price range.
//
// Pure (no Supabase, no React): the page reads the StudioDoc + store prices and
// hands them here; the e2e fixture page does the same with a canned doc.
//
// Price rule (an ESTIMATE, labelled so on the page; an engineer confirms the
// real price on WhatsApp — never a promise):
//   known  = the store price of every part we sell (quantity 1, pack price as listed)
//   print  = PRINT_BASE_QAR + PRINT_QAR_PER_GRAM × printed grams
//            (owner rule 2026-10-11: QAR 100 base + QAR 0.7 per gram of material)
//   low    = print + known, rounded down to QAR 10
//   high   = (print + known) × ESTIMATE_SPREAD, rounded up to QAR 50
// ESTIMATE_SPREAD covers the parts we still have to source, finishing and
// assembly (default 1.5). The usage-price rule
// (lib/pricing/usage-price.ts) is for per-use costs such as cloud CAD builds;
// none apply to a made product, so it is not part of this estimate.

import type { Locale } from "./client/api";
import type { LibraryPart, StudioDoc } from "./schema";

export const ESTIMATE_SPREAD = 1.5;
export const PRINT_BASE_QAR = 100;
export const PRINT_QAR_PER_GRAM = 0.7;

/** Set on doc.answers when "Get it made" was sent (ISO time). */
export const REQUEST_SENT_KEY = "request:sent";

export type PriceEstimate = { low: number; high: number };

/** Printing price: QAR 100 base + QAR 0.7 per gram of material. */
export function printPrice(grams: number): number {
  const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
  return PRINT_BASE_QAR + PRINT_QAR_PER_GRAM * g;
}

export function priceEstimate({ printedGrams, partsQar }: { printedGrams: number; partsQar: number }): PriceEstimate | null {
  const base = printPrice(printedGrams) + (Number.isFinite(partsQar) && partsQar > 0 ? partsQar : 0);
  if (base <= 0) return null;
  const low = Math.max(10, Math.floor(base / 10) * 10);
  const high = Math.max(low + 50, Math.ceil((base * ESTIMATE_SPREAD) / 50) * 50);
  return { low, high };
}

export type SummaryPart = { id: string; name: string; priced: boolean };
export type SummaryPrinted = { template: string; material: string; count: number; grams: number };

export type RequestSummary = {
  name: string;
  oneLine: string;
  parts: SummaryPart[];
  printed: SummaryPrinted[];
  printedGrams: number;
  enclosure: { template: string; colour: string; finish: string } | null;
  partsQar: number;
  estimate: PriceEstimate | null;
  requestedAt: string | null;
};

/**
 * `prices` maps a store SKU to its listed QAR price (published products only).
 * A part counts as priced when its FIRST linked SKU has a price.
 */
export function requestSummary({
  doc,
  projectName,
  getPart,
  locale,
  prices,
}: {
  doc: StudioDoc | null;
  projectName: string;
  getPart: (id: string) => LibraryPart | undefined;
  locale: Locale;
  prices: ReadonlyMap<string, number>;
}): RequestSummary {
  const parts: SummaryPart[] = [];
  let partsQar = 0;
  for (const c of doc?.components ?? []) {
    const lib = getPart(c.partId);
    const sku = lib?.storeSkus?.[0];
    const price = sku ? prices.get(sku) : undefined;
    const priced = typeof price === "number" && Number.isFinite(price) && price > 0;
    if (priced) partsQar += price;
    parts.push({ id: c.instanceId, name: lib?.name[locale] ?? c.label, priced });
  }

  // One row per template + material (the Print step's grouping), lid and base first.
  const rows = new Map<string, SummaryPrinted>();
  for (const m of doc?.mech ?? []) {
    const key = `${m.template}:${m.printable.material}`;
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.grams += m.printable.estGrams;
    } else rows.set(key, { template: m.template, material: m.printable.material, count: 1, grams: m.printable.estGrams });
  }
  const FIRST = ["base", "lid"];
  const rank = (r: SummaryPrinted) => (FIRST.includes(r.template) ? FIRST.indexOf(r.template) : FIRST.length);
  const printed = [...rows.values()].sort((a, b) => rank(a) - rank(b)).map((r) => ({ ...r, grams: Math.round(r.grams) }));
  const printedGrams = printed.reduce((g, r) => g + r.grams, 0);

  const e = doc?.enclosure ?? null;
  const sent = doc?.answers?.[REQUEST_SENT_KEY];
  return {
    name: (doc?.spec.name || projectName || "").trim(),
    oneLine: (doc?.spec.oneLine ?? "").trim(),
    parts,
    printed,
    printedGrams,
    enclosure: e ? { template: e.template, colour: e.colour, finish: e.finish } : null,
    partsQar: Math.round(partsQar * 100) / 100,
    estimate: priceEstimate({ printedGrams, partsQar }),
    requestedAt: typeof sent === "string" && sent ? sent : null,
  };
}
