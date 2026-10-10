// Loads what classifyStock() needs (server only; super admin through the
// cookie client, RLS applies). Used by the dashboard home (Buy tile) and the
// stock page, so both show the same numbers.
//
// Own stock ("we hold it in Lusail"):
//   - after migration 0069: table own_stock (part_id, qty), counted down by sales;
//   - before it: the sum of received quantities in restock_receipts (0037),
//     which never counts down. `ownStockReady` says which one is in use.

import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { createClient } from "@/lib/supabase/server";
import {
  BUY_WINDOW_DAYS,
  classifyStock,
  type SignalKind,
  type StockLists,
  type StockPart,
  type StockSignal,
} from "@/lib/admin/stock-lists";

type Db = Awaited<ReturnType<typeof createClient>>;

type PartRow = {
  id: string;
  sku: string;
  name: string;
  unit_price: number | string | null;
  image_url: string | null;
  images: unknown;
  landed_cost_qar: number | string | null;
  lead_time_class: string | null;
  preferred_offer_id: string | null;
  is_test?: boolean | null;
};

type SignalRow = { part_id: string; kind: string; quantity: number | null; user_id: string | null; created_at: string };

const PART_COLS = "id, sku, name, unit_price, image_url, images, landed_cost_qar, lead_time_class, preferred_offer_id, is_test";

function chunks<T>(list: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function photoOf(p: { image_url: string | null; images: unknown }): string | null {
  const imgs = Array.isArray(p.images) ? (p.images as { thumb?: string; web?: string }[]) : [];
  const first = imgs.find((im) => im && (im.thumb || im.web));
  return first?.thumb ?? first?.web ?? (p.image_url && /^https?:\/\//i.test(p.image_url) ? p.image_url : null);
}

export type StockData = {
  lists: StockLists;
  /** True once migration 0069 (own_stock) is in the database. */
  ownStockReady: boolean;
};

/**
 * `buyOnly`: only products with a cart add or request in the last 30 days are
 * read (what the Buy tile needs). Otherwise every published product is read so
 * "Watch" and "Do not buy" are complete.
 */
export async function loadStockData(db: Db, opts: { buyOnly?: boolean } = {}): Promise<StockData | null> {
  const since = new Date(Date.now() - BUY_WINDOW_DAYS * 864e5).toISOString();

  const sigRes = await fetchAllRows<SignalRow>((from, to) => {
    let q = db
      .from("demand_signals")
      .select("part_id, kind, quantity, user_id, created_at")
      .not("part_id", "is", null)
      .is("served_at", null);
    q = opts.buyOnly ? q.in("kind", ["add_to_cart", "request"]).gte("created_at", since) : q.in("kind", ["view", "add_to_cart", "request"]);
    return q.order("id").range(from, to);
  });
  if (sigRes.error) return null;
  const signals: StockSignal[] = sigRes.rows.map((r) => ({
    partId: r.part_id,
    kind: r.kind as SignalKind,
    quantity: r.quantity,
    userId: r.user_id,
    createdAt: r.created_at,
  }));

  // Products: all published (full) or only those with a recent signal (buy only).
  let partRows: PartRow[] = [];
  if (opts.buyOnly) {
    const ids = [...new Set(signals.map((s) => s.partId))];
    for (const part of chunks(ids)) {
      const { data } = await db.from("parts").select(PART_COLS).in("id", part).eq("is_published", true).is("merged_into", null);
      partRows.push(...((data ?? []) as PartRow[]));
    }
  } else {
    const res = await fetchAllRows<PartRow>((from, to) =>
      db.from("parts").select(PART_COLS).eq("is_published", true).is("merged_into", null).order("id").range(from, to)
    );
    if (res.error) return null;
    partRows = res.rows;
  }

  // Preferred offer + supplier of every product.
  const offerIds = [...new Set(partRows.map((p) => p.preferred_offer_id).filter((x): x is string => !!x))];
  const offers: { id: string; supplier_id: string; supplier_sku: string | null; supplier_url: string | null; moq: number | null }[] = [];
  for (const ids of chunks(offerIds)) {
    const { data } = await db.from("supplier_offers").select("id, supplier_id, supplier_sku, supplier_url, moq").in("id", ids);
    offers.push(...((data ?? []) as typeof offers));
  }
  const { data: supplierData } = await db.from("suppliers").select("id, name, min_order_value_qar");
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const supplierById = new Map((supplierData ?? []).map((s) => [s.id as string, s]));

  // Own stock: 0069 table first, else the receipts total.
  const own = new Map<string, number>();
  let ownStockReady = true;
  const ownRes = await fetchAllRows<{ part_id: string; qty: number }>((from, to) =>
    db.from("own_stock").select("part_id, qty").order("part_id").range(from, to)
  );
  if (ownRes.error) {
    ownStockReady = false;
    const rec = await fetchAllRows<{ part_id: string; quantity: number }>((from, to) =>
      db.from("restock_receipts").select("part_id, quantity").order("id").range(from, to)
    );
    for (const r of rec.rows) own.set(r.part_id, (own.get(r.part_id) ?? 0) + Number(r.quantity || 0));
  } else {
    for (const r of ownRes.rows) own.set(r.part_id, Number(r.qty || 0));
  }

  const parts: StockPart[] = partRows.map((p) => {
    const o = p.preferred_offer_id ? offerById.get(p.preferred_offer_id) : undefined;
    const sup = o ? supplierById.get(o.supplier_id) : undefined;
    return {
      id: p.id,
      sku: p.sku,
      name: p.name,
      isTest: p.is_test ?? false,
      photo: photoOf(p),
      price: Number(p.unit_price) || 0,
      landedCost: p.landed_cost_qar === null || p.landed_cost_qar === undefined ? null : Number(p.landed_cost_qar),
      supplier: sup
        ? {
            id: sup.id as string,
            name: sup.name as string,
            minOrderValue: sup.min_order_value_qar === null ? null : Number(sup.min_order_value_qar),
          }
        : null,
      supplierSku: o?.supplier_sku ?? null,
      supplierUrl: o?.supplier_url ?? null,
      moq: Math.max(1, Number(o?.moq ?? 1) || 1),
      leadTimeClass: p.lead_time_class,
      ownQty: own.get(p.id) ?? 0,
    };
  });

  return { lists: classifyStock(parts, signals), ownStockReady };
}
