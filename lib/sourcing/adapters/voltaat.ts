// Voltaat adapter (Task 19g). Voltaat is a Shopify store in Qatar (prices in
// QAR). We read its public catalogue feed — /products.json, allowed by its
// robots.txt — for NUMBERS ONLY: price and whether a variant is available.
// Rules: honour robots.txt, one request every 5 seconds, an honest user agent
// with a contact address, one run a day. A 403/429 stops the run; we never
// retry around a block.

import type { SupplierAdapter } from "@/lib/sourcing/types";

export const voltaatAdapter: SupplierAdapter = { code: "voltaat", kind: "api" };

export const VOLTAAT_BASE = "https://www.voltaat.com";
export const USER_AGENT = "GestaltungPriceSync/1.0 (+https://gestaltung360.com; info@gestaltung360.com)";
export const REQUEST_GAP_MS = 5000;
const PAGE_SIZE = 250;
const MAX_PAGES = 40;

export type VoltaatVariant = { id: number; sku: string | null; title: string; price: number; available: boolean };
export type VoltaatProduct = { handle: string; title: string; variants: VoltaatVariant[] };

export class BlockedError extends Error {
  constructor(public status: number) {
    super(`blocked_${status}`);
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

/** "https://www.voltaat.com/products/arduino-uno?variant=1" → "arduino-uno" */
export function handleFromUrl(url: string | null | undefined): string | null {
  const m = /\/products\/([^/?#]+)/i.exec(url ?? "");
  return m ? decodeURIComponent(m[1]).toLowerCase() : null;
}

/** "?variant=123" → 123 */
export function variantFromUrl(url: string | null | undefined): number | null {
  const m = /[?&]variant=(\d+)/.exec(url ?? "");
  return m ? Number(m[1]) : null;
}

/**
 * robots.txt check for our user agent: the group for "*" (we have no named
 * group), longest matching rule wins, Allow wins a tie. Supports * and $.
 */
export function robotsAllows(robots: string, path: string): boolean {
  const rules: { allow: boolean; pattern: string }[] = [];
  let inStar = false;
  let lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") {
      inStar = lastWasAgent ? inStar || val === "*" : val === "*";
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar || (key !== "allow" && key !== "disallow") || !val) continue;
    rules.push({ allow: key === "allow", pattern: val });
  }
  let best: { allow: boolean; len: number } | null = null;
  for (const r of rules) {
    const re = new RegExp(
      "^" + r.pattern.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$|\$$/, "$")
    );
    if (!re.test(path)) continue;
    const len = r.pattern.length;
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
  }
  return best ? best.allow : true;
}

type RawProduct = { handle: string; title: string; variants: { id: number; sku: string | null; title: string; price: string; available: boolean }[] };

export function parseProducts(json: unknown): VoltaatProduct[] {
  const list = (json as { products?: RawProduct[] })?.products ?? [];
  return list.map((p) => ({
    handle: String(p.handle).toLowerCase(),
    title: p.title,
    variants: (p.variants ?? []).map((v) => ({
      id: v.id,
      sku: v.sku || null,
      title: v.title,
      price: Number(v.price),
      available: Boolean(v.available),
    })),
  }));
}

/**
 * The variant an offer follows: the one named in the offer URL (?variant=),
 * else the one whose SKU or id is the offer's supplier SKU, else the only one.
 */
export function pickVariant(p: VoltaatProduct, offer: { supplier_sku: string | null; supplier_url: string | null }): VoltaatVariant | null {
  const vid = variantFromUrl(offer.supplier_url);
  if (vid) return p.variants.find((v) => v.id === vid) ?? null;
  const sku = offer.supplier_sku?.trim().toLowerCase();
  if (sku) {
    const hit = p.variants.find((v) => v.sku?.toLowerCase() === sku || String(v.id) === sku);
    if (hit) return hit;
  }
  return p.variants.length === 1 ? p.variants[0] : null;
}

export type MappedOffer = {
  id: string;
  part_id: string;
  part_name: string;
  our_price: number;
  supplier_sku: string | null;
  supplier_url: string | null;
  retail_price: number | null;
  availability: string;
  lead_time_days: number | null;
};

export type OfferChange = {
  offerId: string;
  partId: string;
  partName: string;
  handle: string;
  oldRetail: number | null;
  newRetail: number;
  oldAvailability: string;
  newAvailability: "in_stock" | "unavailable";
  oldOurPrice: number;
};

/** Voltaat is local: in stock → 1 day to reach us. Out of stock keeps the lead time we knew. */
export const VOLTAAT_IN_STOCK_DAYS = 1;

export function planChanges(
  offers: MappedOffer[],
  catalogue: Map<string, VoltaatProduct>
): { changes: OfferChange[]; checked: number; missing: { offerId: string; partName: string; reason: "no_handle" | "not_in_catalogue" | "variant_unclear" }[] } {
  const changes: OfferChange[] = [];
  const missing: { offerId: string; partName: string; reason: "no_handle" | "not_in_catalogue" | "variant_unclear" }[] = [];
  let checked = 0;
  for (const o of offers) {
    const handle = handleFromUrl(o.supplier_url);
    if (!handle) {
      missing.push({ offerId: o.id, partName: o.part_name, reason: "no_handle" });
      continue;
    }
    const p = catalogue.get(handle);
    if (!p) {
      missing.push({ offerId: o.id, partName: o.part_name, reason: "not_in_catalogue" });
      continue;
    }
    const v = pickVariant(p, o);
    if (!v || !Number.isFinite(v.price)) {
      missing.push({ offerId: o.id, partName: o.part_name, reason: "variant_unclear" });
      continue;
    }
    checked++;
    const newAvailability = v.available ? "in_stock" : "unavailable";
    if (Number(o.retail_price) !== v.price || o.availability !== newAvailability) {
      changes.push({
        offerId: o.id,
        partId: o.part_id,
        partName: o.part_name,
        handle,
        oldRetail: o.retail_price === null ? null : Number(o.retail_price),
        newRetail: v.price,
        oldAvailability: o.availability,
        newAvailability,
        oldOurPrice: Number(o.our_price),
      });
    }
  }
  return { changes, checked, missing };
}

// ── Network (server only) ───────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class VoltaatClient {
  requests = 0;
  private last = 0;

  private async get(path: string): Promise<Response> {
    const wait = this.last + REQUEST_GAP_MS - Date.now();
    if (this.last && wait > 0) await sleep(wait);
    this.last = Date.now();
    this.requests++;
    const res = await fetch(`${VOLTAAT_BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/plain" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 403 || res.status === 429) throw new BlockedError(res.status);
    return res;
  }

  async robots(): Promise<string> {
    const res = await this.get("/robots.txt");
    if (!res.ok) throw new Error(`robots_${res.status}`);
    return res.text();
  }

  /** The whole public catalogue, 250 products per request. */
  async catalogue(): Promise<Map<string, VoltaatProduct>> {
    const out = new Map<string, VoltaatProduct>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.get(`/products.json?limit=${PAGE_SIZE}&page=${page}`);
      if (!res.ok) throw new Error(`catalogue_${res.status}`);
      const products = parseProducts(await res.json());
      for (const p of products) out.set(p.handle, p);
      if (products.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** One product, for mapping it to ours. */
  async product(handle: string): Promise<VoltaatProduct | null> {
    const res = await this.get(`/products/${encodeURIComponent(handle)}.json`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`product_${res.status}`);
    const d = (await res.json()) as { product?: RawProduct };
    return d.product ? parseProducts({ products: [d.product] })[0] : null;
  }
}
