// The catalogue as the apps browse it: one category at a time, with a picture.
//
// WHY A ROUTE OF ITS OWN. /api/mobile/report answers with the whole website in
// one generic shape, which is right for reading figures and wrong for browsing
// a list: the owner wants to pick a category, see a thumbnail, and fix a name
// or a price without waiting for a few dozen selects to run again. So this is
// a small, typed, fast read, plus the one edit it needs.
//
// Pure: rows in, a list out. Nothing here touches the database or the clock.

import { popoverPhoto } from "@/lib/studio/part-photo";

/** Products with no category of their own are gathered under this key. */
export const UNCATEGORISED = "uncategorised";

/** The thumbnail width asked of the image host: 48pt at 3x. */
export const THUMB_WIDTH = 144;

export type ProductPartRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  store_category: string | null;
  unit_price: number | string | null;
  landed_cost_qar: number | string | null;
  stock_status: string | null;
  is_published: boolean | null;
  in_own_stock: boolean | null;
  merged_into: string | null;
  is_test: boolean | null;
  image_url: string | null;
  images: unknown;
  lead_time_class: string | null;
};

export type ProductStockRow = { part_id: string; qty: number | string | null };

export type ProductItem = {
  id: string;
  sku: string | null;
  name: string;
  category: string;
  categoryKey: string;
  /** Null when the product has no price, so the app can say so rather than "0". */
  price: number | null;
  cost: number | null;
  /** Units on our own shelf, or null when we do not hold this product. */
  stock: number | null;
  status: string;
  published: boolean;
  /** An https thumbnail from a host we allow, or null to draw an icon instead. */
  photo: string | null;
};

export type CategoryOption = { key: string; label: string; count: number };

export type ProductList = {
  categories: CategoryOption[];
  /** The key these items belong to, or null when the list is everything. */
  category: string | null;
  /** How many products match before the cap. */
  total: number;
  items: ProductItem[];
};

/** A number from Postgres, which may arrive as a string; null when absent. */
function maybeNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function prettify(value: string): string {
  return value.replace(/[_-]+/g, " ").trim();
}

/** The raw category a product belongs to: the store's own, else the old one. */
export function rawCategory(p: ProductPartRow): string | null {
  const value = (p.store_category || p.category || "").trim();
  return value ? value : null;
}

/** The stable key used in the query string, lower-cased so case cannot split a category. */
export function categoryKey(p: ProductPartRow): string {
  const raw = rawCategory(p);
  return raw ? raw.toLowerCase() : UNCATEGORISED;
}

/** Not merged into a survivor, not a test row: a product the owner actually has. */
export function isLive(p: ProductPartRow): boolean {
  return !p.merged_into && p.is_test !== true;
}

export function toItem(p: ProductPartRow, stock: Map<string, number>): ProductItem {
  const raw = rawCategory(p);
  return {
    id: p.id,
    sku: p.sku,
    name: p.name || p.sku || "Untitled product",
    category: raw ? prettify(raw) : "Uncategorised",
    categoryKey: categoryKey(p),
    price: maybeNum(p.unit_price),
    cost: maybeNum(p.landed_cost_qar),
    stock: p.in_own_stock ? (stock.get(p.id) ?? 0) : null,
    status: p.is_published ? prettify(p.stock_status || "unknown") : "draft",
    published: p.is_published === true,
    photo: popoverPhoto(
      { image_url: p.image_url, images: p.images, lead_time_class: p.lead_time_class as never },
      THUMB_WIDTH,
    ),
  };
}

export type ProductListInput = {
  parts: ProductPartRow[];
  ownStock: ProductStockRow[];
  /** The chosen category key, or null for everything. An unknown key yields no items. */
  category: string | null;
  limit: number;
};

export function buildProductList(input: ProductListInput): ProductList {
  const live = input.parts.filter(isLive);
  const stock = new Map(input.ownStock.map((s) => [s.part_id, maybeNum(s.qty) ?? 0]));

  // Every category that exists, with how many products are in it, so the app
  // can draw the picker without a second request.
  const counts = new Map<string, { label: string; count: number }>();
  for (const p of live) {
    const key = categoryKey(p);
    const raw = rawCategory(p);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { label: raw ? prettify(raw) : "Uncategorised", count: 1 });
  }

  const categories = [...counts.entries()]
    .map(([key, v]) => ({ key, label: v.label, count: v.count }))
    .sort((a, b) =>
      // Uncategorised last, everything else by name.
      a.key === UNCATEGORISED ? 1 : b.key === UNCATEGORISED ? -1 : a.label.localeCompare(b.label),
    );

  const chosen = input.category ? live.filter((p) => categoryKey(p) === input.category) : live;
  const sorted = [...chosen].sort((a, b) => (a.name || a.sku || "").localeCompare(b.name || b.sku || ""));

  return {
    categories,
    category: input.category,
    total: sorted.length,
    items: sorted.slice(0, Math.max(0, input.limit)).map((p) => toItem(p, stock)),
  };
}

// ----------------------------------------------------------------- the edit

/**
 * What one edit from an app may change: a product's name, its price, or both.
 * Deliberately nothing else — not the category, not the stock status, not
 * whether it is published. Those decide how the shop behaves and belong on the
 * website, where there is room to explain them.
 */
export type ProductEdit = { partId: string; name?: string; unitPrice?: number };

export const NAME_MAX = 200;
export const PRICE_MAX = 1_000_000;

/** Same shape the other mobile server helpers answer with. */
export type MobileProductResult<T> = { ok: true; data: T } | { ok: false; error: "unavailable" | "not_found" };

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseProductEdit(body: unknown): ParseResult<ProductEdit> {
  if (!body || typeof body !== "object") return { ok: false, error: "body" };
  const b = body as Record<string, unknown>;

  const partId = typeof b.partId === "string" ? b.partId.trim() : "";
  if (!partId || partId.length > 64) return { ok: false, error: "partId" };

  const edit: ProductEdit = { partId };

  if (b.name !== undefined && b.name !== null) {
    if (typeof b.name !== "string") return { ok: false, error: "name" };
    const name = b.name.trim();
    if (!name || name.length > NAME_MAX) return { ok: false, error: "name" };
    edit.name = name;
  }

  if (b.unitPrice !== undefined && b.unitPrice !== null) {
    const n = typeof b.unitPrice === "number" ? b.unitPrice : Number(b.unitPrice);
    if (!Number.isFinite(n) || n < 0 || n > PRICE_MAX) return { ok: false, error: "unitPrice" };
    // Money, so two decimals: a price of 1.005 is a typo, not a price.
    edit.unitPrice = Math.round(n * 100) / 100;
  }

  // An edit that changes nothing is a mistake worth reporting, not a no-op
  // write: it usually means the app sent the wrong field name.
  if (edit.name === undefined && edit.unitPrice === undefined) return { ok: false, error: "nothing_to_change" };

  return { ok: true, value: edit };
}
