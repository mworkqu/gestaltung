// parts column privileges (migration 0105, audit DB-09).
//
// From 0105 on, anon and authenticated may SELECT every parts column EXCEPT
// the business's own numbers / sourcing internals (PRIVATE_PART_FIELDS:
// landed cost, expected income, income %, below-floor flag, pricing mode,
// pinned / preferred offer). So a `select("*")` on parts — or an embed
// `part:parts(*)` — from the browser or the user's session now fails with
// "permission denied": public reads name their columns with
// PART_PUBLIC_COLUMNS, and admin pages read the hidden ones through the
// `parts_admin` view (super_admin rows only) via readPartsAdmin().
// The service role still reads the table directly.
//
// Every column of parts that exists today (0011 … 0069) is either below or in
// PRIVATE_PART_FIELDS; a migration that adds a parts column must grant SELECT
// on it to anon/authenticated (0105 grants by column) or list it here.
import { isMissingRelation } from "@/lib/supabase/errors";

/** Every public parts column (all but PRIVATE_PART_FIELDS), comma-separated for select(). */
// 0011 base; tags 0023; attributes, pack_size 0025; images 0029; lead_time_class 0028;
// name_key, merged_into 0030; is_test 0031; datasheet_url, specs, backup_for 0041;
// specs_ar, details_ar_at 0047; store_category(_review) 0048; in_own_stock 0069.
// A literal (not a join) so supabase-js can type the selected row.
export const PART_PUBLIC_COLUMNS =
  "id, sku, name, name_ar, description, description_ar, category, material, standard, unit_price, min_order_qty, stock_status, image_url, is_published, created_at, updated_at, tags, attributes, pack_size, images, lead_time_class, name_key, merged_into, is_test, datasheet_url, specs, backup_for, specs_ar, details_ar_at, store_category, store_category_review, in_own_stock";

/** The admin read view of parts (0105): every column, super_admin rows only. */
export const PARTS_ADMIN_VIEW = "parts_admin";

/**
 * An admin read that needs the hidden columns (or `*`): runs `query` against the
 * parts_admin view; before 0105 runs (no view) it runs again on the table,
 * which still grants every column then.
 */
export async function readPartsAdmin<R extends { error: unknown }>(query: (table: "parts_admin" | "parts") => PromiseLike<R>): Promise<R> {
  const first = await query(PARTS_ADMIN_VIEW);
  return isMissingRelation(first.error) ? query("parts") : first;
}
