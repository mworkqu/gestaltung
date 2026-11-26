// The reads and the one write behind /api/mobile/products.
//
// Everything that shapes the list lives in lib/mobile/products.ts; this file
// only fetches rows and hands them over, and applies an edit to exactly the
// columns that edit named.

import { paged } from "@/lib/mobile/paged";
import { createServiceClient } from "@/lib/supabase/service";
import {
  buildProductList,
  toItem,
  type MobileProductResult,
  type ProductEdit,
  type ProductItem,
  type ProductList,
  type ProductPartRow,
  type ProductStockRow,
} from "@/lib/mobile/products";

const PART_COLUMNS =
  "id,sku,name,category,store_category,unit_price,landed_cost_qar,stock_status,is_published,in_own_stock,merged_into,is_test,image_url,images,lead_time_class";

// Read a page at a time: one request is answered with 1,000 rows at most, and
// the catalogue is past that (lib/mobile/paged.ts).
const PART_CAP = 5000;

export async function loadProducts({
  category,
  limit,
}: {
  category: string | null;
  limit: number;
}): Promise<MobileProductResult<ProductList>> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  const [parts, stock] = await Promise.all([
    paged<ProductPartRow>((from, to) => db.from("parts").select(PART_COLUMNS).order("id").range(from, to), PART_CAP),
    paged<ProductStockRow>(
      (from, to) => db.from("own_stock").select("part_id,qty").order("part_id").range(from, to),
      PART_CAP,
    ),
  ]);

  if (parts.error) return { ok: false, error: "unavailable" };

  return {
    ok: true,
    data: buildProductList({
      parts: parts.rows,
      // Stock is a nicety: without it the list still reads, it just cannot say
      // how many are on the shelf.
      ownStock: stock.rows,
      category,
      limit,
    }),
  };
}

/**
 * Apply one edit and answer with the product as it now stands, so the app
 * shows what the database actually holds rather than what it hoped it sent.
 */
export async function editProduct(edit: ProductEdit): Promise<MobileProductResult<ProductItem>> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  // Only the named columns, and only for a product that is really there and is
  // not a merged duplicate: editing a row that now points at a survivor would
  // change a name nobody sees.
  const patch: { name?: string; unit_price?: number } = {};
  if (edit.name !== undefined) patch.name = edit.name;
  if (edit.unitPrice !== undefined) patch.unit_price = edit.unitPrice;

  const found = await db.from("parts").select("id,merged_into").eq("id", edit.partId).maybeSingle();
  if (found.error) return { ok: false, error: "unavailable" };
  if (!found.data || found.data.merged_into) return { ok: false, error: "not_found" };

  const updated = await db.from("parts").update(patch).eq("id", edit.partId).select(PART_COLUMNS).maybeSingle();
  if (updated.error) return { ok: false, error: "unavailable" };
  if (!updated.data) return { ok: false, error: "not_found" };

  const row = updated.data as unknown as ProductPartRow;
  const shelf = row.in_own_stock
    ? await db.from("own_stock").select("part_id,qty").eq("part_id", edit.partId).maybeSingle()
    : null;
  const stock = new Map<string, number>();
  if (shelf && !shelf.error && shelf.data) {
    const qty = Number(shelf.data.qty);
    stock.set(edit.partId, Number.isFinite(qty) ? qty : 0);
  }

  return { ok: true, data: toItem(row, stock) };
}
