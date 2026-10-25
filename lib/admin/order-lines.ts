// Order lines for the owner's order list and order page (D3, server only):
// each line with its product photo and the supplier it comes from. Reads go
// through the super-admin cookie client (RLS). A failed read never hides the
// orders: the caller gets `failed: true` and shows a notice instead.

import type { createClient } from "@/lib/supabase/server";
import { photoOf } from "@/lib/admin/stock-data";
import { supplierForLine, type LineSupplier, type OfferRef } from "@/lib/orders/line-suppliers";
import { readPartsAdmin } from "@/lib/store/part-columns";

type Db = Awaited<ReturnType<typeof createClient>>;

export type OrderLine = {
  id: string;
  orderId: string;
  partId: string | null;
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  photo: string | null;
  supplier: LineSupplier | null;
  /** Project this line was bought for (0025), when any. */
  projectId: string | null;
};

type ItemRow = {
  id: string;
  order_id: string;
  part_id: string | null;
  part_sku: string;
  part_name: string;
  quantity: number;
  unit_price_qar: number | string;
  line_total_qar: number | string;
  project_id?: string | null;
};
type PartRow = { id: string; image_url: string | null; images: unknown; preferred_offer_id: string | null };
type OfferRow = { id: string; part_id: string; active: boolean; suppliers: { code: string; name: string } | { code: string; name: string }[] | null };

function chunks<T>(list: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function loadOrderLines(db: Db, orderIds: string[]): Promise<{ byOrder: Map<string, OrderLine[]>; failed: boolean }> {
  const byOrder = new Map<string, OrderLine[]>();
  if (orderIds.length === 0) return { byOrder, failed: false };
  let failed = false;

  const items: ItemRow[] = [];
  for (const ids of chunks(orderIds)) {
    const { data, error } = await db
      .from("part_order_items")
      .select("id, order_id, part_id, part_sku, part_name, quantity, unit_price_qar, line_total_qar, project_id")
      .in("order_id", ids);
    if (error) {
      console.error("[orders] order lines:", error.message);
      return { byOrder, failed: true };
    }
    items.push(...((data ?? []) as ItemRow[]));
  }

  const partIds = [...new Set(items.map((i) => i.part_id).filter((v): v is string => !!v))];
  const parts = new Map<string, PartRow>();
  const offers = new Map<string, OfferRef[]>();
  for (const ids of chunks(partIds)) {
    const [p, o] = await Promise.all([
      readPartsAdmin((t) => db.from(t).select("id, image_url, images, preferred_offer_id").in("id", ids)),
      db.from("supplier_offers").select("id, part_id, active, suppliers(code, name)").in("part_id", ids),
    ]);
    if (p.error || o.error) {
      console.error("[orders] order line products:", p.error?.message ?? o.error?.message);
      failed = true;
      continue;
    }
    for (const row of (p.data ?? []) as PartRow[]) parts.set(row.id, row);
    for (const row of (o.data ?? []) as unknown as OfferRow[]) {
      const sup = Array.isArray(row.suppliers) ? row.suppliers[0] : row.suppliers;
      if (!sup) continue;
      const list = offers.get(row.part_id) ?? [];
      list.push({ id: row.id, active: row.active, supplier: { code: sup.code, name: sup.name } });
      offers.set(row.part_id, list);
    }
  }

  for (const it of items) {
    const part = it.part_id ? parts.get(it.part_id) : undefined;
    const line: OrderLine = {
      id: it.id,
      orderId: it.order_id,
      partId: it.part_id,
      sku: it.part_sku,
      name: it.part_name,
      quantity: it.quantity,
      unitPrice: Number(it.unit_price_qar),
      lineTotal: Number(it.line_total_qar),
      photo: part ? photoOf(part) : null,
      supplier: supplierForLine({
        sku: it.part_sku,
        preferredOfferId: part?.preferred_offer_id ?? null,
        offers: it.part_id ? offers.get(it.part_id) : undefined,
      }),
      projectId: it.project_id ?? null,
    };
    const list = byOrder.get(it.order_id) ?? [];
    list.push(line);
    byOrder.set(it.order_id, list);
  }
  return { byOrder, failed };
}
