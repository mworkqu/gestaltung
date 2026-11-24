// Supply, inventory and demand, shaped for the phone / iPad / Mac dashboards.
//
// Pure: no I/O, no Supabase, no Next. Everything here is a function of rows in
// and a plain object out, so the numbers the apps show are unit-testable
// without a database. lib/mobile/business-server.ts does the reading.
//
// The three words mean something specific on this site:
//
//   supply     what we can get, and from whom — suppliers and their offers.
//   inventory  what is on our own shelf in Lusail — own_stock, quantity > 0.
//   demand     what customers have asked for and we could not match — the
//              sourcing gaps — plus what they actually put in a cart or
//              ordered.
//
// "Own stock is sold first" is NOT decided here. That is the site's own rule
// (docs/SOURCING_ORDER.md): own stock is supplier rank 1, ahead of Voltaat,
// DigiKey and Mouser, and the offer is written by applyShelfUnits. The apps
// only report what that rule has already produced.

export const OWN_STOCK_SUPPLIER_CODE = "own_stock";

/** A quantity is only ever a whole number of units, never negative. */
export const QTY_MAX = 1_000_000;

export type PartInput = {
  id: string;
  sku: string | null;
  name: string | null;
  name_ar: string | null;
  category: string | null;
  unit_price: number | string | null;
  stock_status: string | null;
  in_own_stock: boolean | null;
  is_test: boolean | null;
  image_url: string | null;
  pricing_mode: string | null;
  lead_time_class: string | null;
};

export type OwnStockInput = {
  part_id: string;
  qty: number | null;
  updated_at: string | null;
};

export type SupplierInput = {
  id: string;
  code: string | null;
  name: string | null;
  active: boolean | null;
  rank: number | null;
  default_currency: string | null;
};

export type OfferInput = {
  id: string;
  part_id: string;
  supplier_id: string;
  cost: number | string | null;
  retail_price: number | string | null;
  availability: string | null;
  lead_time_days: number | null;
  active: boolean | null;
  last_checked_at: string | null;
};

export type GapInput = {
  id: string;
  project_id: string | null;
  function: string | null;
  spec: string | null;
  kind: string | null;
  quantity: number | null;
  first_seen: string | null;
  last_seen: string | null;
};

export type CartItemInput = { part_id: string | null; quantity: number | null; created_at: string | null };
export type PartOrderInput = { id: string; status: string | null; created_at: string | null; is_test: boolean | null };

// ---------------------------------------------------------------- helpers

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function iso(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Whole units, 0..QTY_MAX. Anything else is rejected rather than coerced. */
export function parseQty(raw: unknown): number | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw < 0 || raw > QTY_MAX) return null;
    return raw;
  }
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{1,7}$/.test(s)) return null;
  const n = Number(s);
  return n >= 0 && n <= QTY_MAX ? n : null;
}

/** An offer only counts as supply if it is active and not marked unavailable. */
export function offerIsLive(o: OfferInput): boolean {
  if (o.active === false) return false;
  const a = (o.availability ?? "").toLowerCase();
  return a !== "out_of_stock" && a !== "discontinued" && a !== "parked";
}

// ---------------------------------------------------------------- shapes

export type InventoryRow = {
  partId: string;
  sku: string | null;
  name: string | null;
  nameAr: string | null;
  category: string | null;
  qty: number;
  unitPrice: number;
  /** qty x unit price, the shelf's worth at shop prices. */
  value: number;
  image: string | null;
  updatedAt: string | null;
};

export type SupplierRow = {
  id: string;
  code: string | null;
  name: string | null;
  rank: number | null;
  active: boolean;
  offers: number;
  liveOffers: number;
  /** Parts this supplier is the only live source for. */
  soleSource: number;
};

export type DemandRow = {
  id: string;
  projectId: string | null;
  what: string | null;
  spec: string | null;
  kind: string | null;
  quantity: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** Days between first and last time a customer asked for it. */
  ageDays: number;
};

export type BusinessSummary = {
  generatedAt: string;
  inventory: {
    lines: number;
    units: number;
    value: number;
    rows: InventoryRow[];
    /** Parts flagged in_own_stock but with no counted units — a mismatch. */
    flaggedButEmpty: number;
  };
  supply: {
    suppliers: SupplierRow[];
    parts: number;
    partsWithNoLiveOffer: number;
    offers: number;
    liveOffers: number;
  };
  demand: {
    gaps: DemandRow[];
    openGaps: number;
    cartUnits: number;
    orders: number;
  };
};

// ---------------------------------------------------------------- building

export type BusinessInput = {
  now: Date;
  parts: PartInput[];
  stock: OwnStockInput[];
  suppliers: SupplierInput[];
  offers: OfferInput[];
  gaps: GapInput[];
  cart: CartItemInput[];
  orders: PartOrderInput[];
  includeTest: boolean;
};

export function buildBusiness(input: BusinessInput): BusinessSummary {
  const { now, includeTest } = input;
  const parts = includeTest ? input.parts : input.parts.filter((p) => p.is_test !== true);
  const byId = new Map(parts.map((p) => [p.id, p]));

  // ---- inventory: own_stock joined to the catalogue ----
  const rows: InventoryRow[] = [];
  for (const s of input.stock) {
    const qty = s.qty ?? 0;
    if (qty <= 0) continue;
    const p = byId.get(s.part_id);
    if (!p) continue; // a test part, or one deleted from the catalogue
    const unitPrice = num(p.unit_price);
    rows.push({
      partId: p.id,
      sku: p.sku,
      name: p.name,
      nameAr: p.name_ar,
      category: p.category,
      qty,
      unitPrice,
      value: Math.round(qty * unitPrice * 100) / 100,
      image: p.image_url,
      updatedAt: iso(s.updated_at),
    });
  }
  rows.sort((a, b) => b.value - a.value || (a.name ?? "").localeCompare(b.name ?? ""));

  const counted = new Map(input.stock.map((s) => [s.part_id, s.qty ?? 0]));
  const flaggedButEmpty = parts.filter((p) => p.in_own_stock === true && (counted.get(p.id) ?? 0) <= 0).length;

  // ---- supply: suppliers and their live offers ----
  const offers = input.offers.filter((o) => byId.has(o.part_id));
  const live = offers.filter(offerIsLive);

  const livePerPart = new Map<string, string[]>();
  for (const o of live) {
    const list = livePerPart.get(o.part_id) ?? [];
    list.push(o.supplier_id);
    livePerPart.set(o.part_id, list);
  }
  const soleSourceBySupplier = new Map<string, number>();
  for (const [, suppliersForPart] of livePerPart) {
    const unique = new Set(suppliersForPart);
    if (unique.size === 1) {
      const only = [...unique][0];
      soleSourceBySupplier.set(only, (soleSourceBySupplier.get(only) ?? 0) + 1);
    }
  }

  const suppliers: SupplierRow[] = input.suppliers
    .map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      rank: s.rank,
      active: s.active !== false,
      offers: offers.filter((o) => o.supplier_id === s.id).length,
      liveOffers: live.filter((o) => o.supplier_id === s.id).length,
      soleSource: soleSourceBySupplier.get(s.id) ?? 0,
    }))
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || (a.name ?? "").localeCompare(b.name ?? ""));

  const partsWithNoLiveOffer = parts.filter((p) => !livePerPart.has(p.id)).length;

  // ---- demand: unmet asks, then carts and orders ----
  const gaps: DemandRow[] = input.gaps
    .map((g) => {
      const first = g.first_seen ? new Date(g.first_seen) : null;
      const last = g.last_seen ? new Date(g.last_seen) : null;
      const ageDays =
        first && last && !Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime())
          ? Math.max(0, Math.round((last.getTime() - first.getTime()) / 86_400_000))
          : 0;
      return {
        id: g.id,
        projectId: g.project_id,
        what: g.function,
        spec: g.spec,
        kind: g.kind,
        quantity: g.quantity ?? 0,
        firstSeen: iso(g.first_seen),
        lastSeen: iso(g.last_seen),
        ageDays,
      };
    })
    .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));

  const cartUnits = input.cart.reduce((n, c) => n + (c.quantity ?? 0), 0);
  const orders = includeTest ? input.orders : input.orders.filter((o) => o.is_test !== true);

  return {
    generatedAt: now.toISOString(),
    inventory: {
      lines: rows.length,
      units: rows.reduce((n, r) => n + r.qty, 0),
      value: Math.round(rows.reduce((n, r) => n + r.value, 0) * 100) / 100,
      rows,
      flaggedButEmpty,
    },
    supply: {
      suppliers,
      parts: parts.length,
      partsWithNoLiveOffer,
      offers: offers.length,
      liveOffers: live.length,
    },
    demand: {
      gaps,
      openGaps: gaps.length,
      cartUnits,
      orders: orders.length,
    },
  };
}

// ---------------------------------------------------------------- add item

/**
 * What the apps send to add something to our own shelf.
 *
 * Either an existing catalogue part (`partId`), or a brand new one (`newPart`)
 * which is created in the catalogue first. Never both.
 */
export type AddStockRequest =
  | { partId: string; qty: number }
  | { newPart: { name: string; sku?: string; category?: string; unitPrice?: number }; qty: number };

export type AddStockParsed =
  | { ok: true; value: AddStockRequest }
  | { ok: false; error: "qty" | "part" | "name" | "both" | "neither" };

const SKU_SAFE = /[^A-Z0-9]+/g;

/** A readable, unique-ish SKU for a part the owner typed in by hand. */
export function skuFromName(name: string, now: Date): string {
  const base = name.trim().toUpperCase().replace(SKU_SAFE, "-").replace(/^-+|-+$/g, "").slice(0, 18) || "ITEM";
  // Minutes since epoch keeps it short and still collision-resistant in practice.
  return `OWN-${base}-${Math.floor(now.getTime() / 60_000).toString(36).toUpperCase()}`;
}

export function parseAddStock(body: unknown, now: Date): AddStockParsed {
  if (!body || typeof body !== "object") return { ok: false, error: "neither" };
  const b = body as Record<string, unknown>;

  const qty = parseQty(b.qty);
  if (qty === null) return { ok: false, error: "qty" };

  const hasPartId = typeof b.partId === "string" && b.partId.trim() !== "";
  const hasNew = b.newPart !== null && typeof b.newPart === "object";
  if (hasPartId && hasNew) return { ok: false, error: "both" };
  if (!hasPartId && !hasNew) return { ok: false, error: "neither" };

  if (hasPartId) {
    const id = String(b.partId).trim();
    // A part id is a uuid; anything else is a client bug, not a lookup miss.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: "part" };
    return { ok: true, value: { partId: id, qty } };
  }

  const np = b.newPart as Record<string, unknown>;
  const name = typeof np.name === "string" ? np.name.trim() : "";
  if (name.length < 2 || name.length > 200) return { ok: false, error: "name" };

  const sku = typeof np.sku === "string" && np.sku.trim() !== "" ? np.sku.trim().slice(0, 64) : skuFromName(name, now);
  const category = typeof np.category === "string" && np.category.trim() !== "" ? np.category.trim().slice(0, 64) : "other";
  const unitPrice = typeof np.unitPrice === "number" && Number.isFinite(np.unitPrice) && np.unitPrice >= 0 ? np.unitPrice : 0;

  return { ok: true, value: { newPart: { name, sku, category, unitPrice }, qty } };
}

/** The row written to `parts` for an item the owner added by hand. */
export function newPartRow(p: { name: string; sku?: string; category?: string; unitPrice?: number }, now: Date) {
  return {
    sku: p.sku ?? skuFromName(p.name, now),
    name: p.name,
    category: p.category ?? "other",
    unit_price: p.unitPrice ?? 0,
    min_order_qty: 1,
    pack_size: 1,
    stock_status: "in_stock",
    // Not shown in the shop until the owner fills in the rest of it.
    is_published: false,
    pricing_mode: "markup",
    tags: [] as string[],
    attributes: {},
    images: [],
    below_floor: false,
    is_test: false,
    store_category_review: false,
    in_own_stock: true,
  };
}

/** Catalogue search: name, Arabic name or SKU, case-insensitive. */
export function matchesSearch(p: PartInput, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  return [p.name, p.name_ar, p.sku].some((v) => (v ?? "").toLowerCase().includes(needle));
}
