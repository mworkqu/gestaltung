// The reads and the one write behind /api/mobile/business and /api/mobile/stock.
//
// Everything that decides a number lives in lib/mobile/business.ts; this file
// only fetches rows and hands them over. The write goes through
// lib/admin/shelf-apply.ts, which is the same code the website's own stock page
// uses — so adding an item from the phone and adding it from the dashboard
// cannot drift apart.

import { applyShelfUnits, type ShelfResult } from "@/lib/admin/shelf-apply";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildBusiness,
  matchesSearch,
  newPartRow,
  type AddStockRequest,
  type BusinessSummary,
  type CartItemInput,
  type GapInput,
  type OfferInput,
  type OwnStockInput,
  type PartInput,
  type PartOrderInput,
  type SupplierInput,
} from "@/lib/mobile/business";

export type MobileResult<T> = { ok: true; data: T } | { ok: false; error: "unavailable" | "not_found" | string };

const PART_COLUMNS =
  "id,sku,name,name_ar,category,unit_price,stock_status,in_own_stock,is_test,image_url,pricing_mode,lead_time_class";
const OFFER_COLUMNS = "id,part_id,supplier_id,cost,retail_price,availability,lead_time_days,active,last_checked_at";
const SUPPLIER_COLUMNS = "id,code,name,active,rank,default_currency";
const GAP_COLUMNS = "id,project_id,function,spec,kind,quantity,first_seen,last_seen";

const GAP_CAP = 500;
const CART_CAP = 1000;
const ORDER_CAP = 500;

export async function loadBusiness({ includeTest }: { includeTest: boolean }): Promise<MobileResult<BusinessSummary>> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  // PostgREST stops at 1000 rows a request, and the catalogue is past that, so
  // parts, own stock and offers are paged. A truncated read here would quietly
  // under-count every number on the screen rather than fail.
  const [parts, stock, offers, suppliers, gaps, cart, orders] = await Promise.all([
    fetchAllRows<PartInput>((from, to) => db.from("parts").select(PART_COLUMNS).order("id").range(from, to)),
    fetchAllRows<OwnStockInput>((from, to) =>
      db.from("own_stock").select("part_id,qty,updated_at").order("part_id").range(from, to)
    ),
    fetchAllRows<OfferInput>((from, to) => db.from("supplier_offers").select(OFFER_COLUMNS).order("id").range(from, to)),
    db.from("suppliers").select(SUPPLIER_COLUMNS).limit(100),
    db.from("sourcing_gaps").select(GAP_COLUMNS).order("last_seen", { ascending: false }).limit(GAP_CAP),
    db.from("cart_items").select("part_id,quantity,created_at").limit(CART_CAP),
    db.from("part_orders").select("id,status,created_at,is_test").limit(ORDER_CAP),
  ]);

  // One unreadable table should not blank the whole screen, but the catalogue
  // is the spine of all three sections — without it there is nothing to show.
  if (parts.error) return { ok: false, error: "unavailable" };

  return {
    ok: true,
    data: buildBusiness({
      now: new Date(),
      includeTest,
      parts: parts.rows,
      stock: stock.rows,
      offers: offers.rows,
      suppliers: (suppliers.data ?? []) as unknown as SupplierInput[],
      gaps: (gaps.data ?? []) as unknown as GapInput[],
      cart: (cart.data ?? []) as unknown as CartItemInput[],
      orders: (orders.data ?? []) as unknown as PartOrderInput[],
    }),
  };
}

export type PartHit = {
  id: string;
  sku: string | null;
  name: string | null;
  nameAr: string | null;
  category: string | null;
  unitPrice: number;
  onShelf: number;
  image: string | null;
};

/**
 * Catalogue search for the "add an item" screen, with the units already on the
 * shelf for each hit — so the owner can see they have it before adding more.
 */
export async function searchCatalogue(q: string, limit = 25): Promise<MobileResult<PartHit[]>> {
  const needle = q.trim();
  if (needle.length < 2) return { ok: true, data: [] };

  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  // Ask the database to narrow it first; matchesSearch then applies exactly the
  // same rule the tests cover, so the two can never disagree.
  const like = `%${needle.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const res = await db
    .from("parts")
    .select(PART_COLUMNS)
    .or(`name.ilike.${like},name_ar.ilike.${like},sku.ilike.${like}`)
    .eq("is_test", false)
    .limit(limit * 2);
  if (res.error) return { ok: false, error: "unavailable" };

  const hits = ((res.data ?? []) as unknown as PartInput[]).filter((p) => matchesSearch(p, needle)).slice(0, limit);
  if (hits.length === 0) return { ok: true, data: [] };

  const stock = await db
    .from("own_stock")
    .select("part_id,qty")
    .in("part_id", hits.map((p) => p.id));
  const onShelf = new Map(((stock.data ?? []) as { part_id: string; qty: number | null }[]).map((s) => [s.part_id, s.qty ?? 0]));

  return {
    ok: true,
    data: hits.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      nameAr: p.name_ar,
      category: p.category,
      unitPrice: Number(p.unit_price) || 0,
      onShelf: onShelf.get(p.id) ?? 0,
      image: p.image_url,
    })),
  };
}

export type AddStockOutcome = {
  partId: string;
  /** True when the part did not exist and was created in the catalogue. */
  created: boolean;
  sku: string | null;
  name: string | null;
  shelf: ShelfResult;
};

/**
 * Put units on our own shelf.
 *
 * An existing part is counted straight away. A new one is written to the
 * catalogue first (unpublished, so it does not appear in the shop until the
 * owner finishes it) and then counted. Either way the count goes through
 * applyShelfUnits, which also gives the product the own-stock offer at 1 day —
 * that is what makes "mine is sold first" true, per docs/SOURCING_ORDER.md.
 */
export async function addStock(req: AddStockRequest): Promise<MobileResult<AddStockOutcome>> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  let partId: string;
  let created = false;
  let sku: string | null = null;
  let name: string | null = null;

  if ("partId" in req) {
    const found = await db.from("parts").select("id,sku,name").eq("id", req.partId).maybeSingle();
    if (found.error) return { ok: false, error: "unavailable" };
    if (!found.data) return { ok: false, error: "not_found" };
    partId = found.data.id as string;
    sku = (found.data.sku as string | null) ?? null;
    name = (found.data.name as string | null) ?? null;
  } else {
    const row = newPartRow(req.newPart, new Date());
    const ins = await db.from("parts").insert(row).select("id,sku,name").single();
    if (ins.error || !ins.data) return { ok: false, error: ins.error?.message ?? "unavailable" };
    partId = ins.data.id as string;
    sku = (ins.data.sku as string | null) ?? null;
    name = (ins.data.name as string | null) ?? null;
    created = true;
  }

  const shelf = await applyShelfUnits(db as never, partId, req.qty);
  return { ok: true, data: { partId, created, sku, name, shelf } };
}
