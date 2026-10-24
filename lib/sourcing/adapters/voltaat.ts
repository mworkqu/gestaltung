// Voltaat adapter (Task 19g). Voltaat is a Shopify store in Qatar (prices in
// QAR). We read its public catalogue feed — /products.json, allowed by its
// robots.txt — for NUMBERS ONLY: price and whether a variant is available.
// Rules: honour robots.txt, one request every 5 seconds, an honest user agent
// with a contact address, one run a day. A 403/429 stops the run; we never
// retry around a block.

import { SUPPLIER_LEAD_DAYS } from "@/lib/sourcing/lead-times";

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

/** A product exactly as /products.json returns it (used only by the catalogue import). */
export type RawProductFull = RawProduct & {
  id: number;
  body_html?: string | null;
  product_type?: string | null;
  tags?: string[] | string | null;
  images?: { src: string; variant_ids?: number[] }[];
  variants: (RawProduct["variants"][number] & { featured_image?: { src: string } | null })[];
};

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
  /** false once the product is "order on request" (dropped from Voltaat's list or out of stock). */
  active?: boolean;
};

/** A mapped product Voltaat no longer lists: it becomes "order on request" (offer inactive). */
export type DroppedOffer = {
  offerId: string;
  partId: string;
  partName: string;
  /** true when the offer was already inactive, so this is not news. */
  alreadyOnRequest: boolean;
};

/** A mapped product whose link or option we can't follow (needs the owner to re-map it). */
export type MissingOffer = { offerId: string; partName: string; reason: "no_handle" | "variant_unclear" };

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

/** Voltaat is local but not ours: in stock → 2 days to reach us (lib/sourcing/lead-times.ts). Out of stock keeps the lead time we knew. */
export const VOLTAAT_IN_STOCK_DAYS = SUPPLIER_LEAD_DAYS.voltaat;

export function planChanges(
  offers: MappedOffer[],
  catalogue: Map<string, VoltaatProduct>
): { changes: OfferChange[]; checked: number; missing: MissingOffer[]; dropped: DroppedOffer[] } {
  const changes: OfferChange[] = [];
  const missing: MissingOffer[] = [];
  const dropped: DroppedOffer[] = [];
  let checked = 0;
  for (const o of offers) {
    const handle = handleFromUrl(o.supplier_url);
    if (!handle) {
      missing.push({ offerId: o.id, partName: o.part_name, reason: "no_handle" });
      continue;
    }
    const p = catalogue.get(handle);
    if (!p) {
      // Removed from Voltaat's list → "order on request" (owner rule 2026-10-16), not a daily nag.
      dropped.push({ offerId: o.id, partId: o.part_id, partName: o.part_name, alreadyOnRequest: o.active === false });
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
  return { changes, checked, missing, dropped };
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

  /** The whole public catalogue as Voltaat returns it, 250 products per request. */
  async rawCatalogue(): Promise<RawProductFull[]> {
    const out: RawProductFull[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await this.get(`/products.json?limit=${PAGE_SIZE}&page=${page}`);
      if (!res.ok) throw new Error(`catalogue_${res.status}`);
      const products = ((await res.json()) as { products?: RawProductFull[] }).products ?? [];
      out.push(...products);
      if (products.length < PAGE_SIZE) break;
    }
    return out;
  }

  /** The whole public catalogue, numbers only, keyed by handle. */
  async catalogue(): Promise<Map<string, VoltaatProduct>> {
    const out = new Map<string, VoltaatProduct>();
    for (const p of parseProducts({ products: await this.rawCatalogue() })) out.set(p.handle, p);
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
