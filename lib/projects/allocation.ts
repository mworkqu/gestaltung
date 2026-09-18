import type { SupabaseClient } from "@supabase/supabase-js";

// ── Where a part on a project comes from ────────────────────────────────────
//
// A part is either on the client's shelf or committed to a project, never both.
// So adding units to a project takes whatever they already own off the shelf
// first, and only buys the shortfall.
//
// Removing units reverses it in the opposite order: the cart portion goes back
// first (nothing was ever theirs), and only then do shelf units return to the
// shelf. That way a client who trims a quantity doesn't get parts handed back
// that they never owned.

export type Allocation = {
  /** Units taken off the client's own inventory. */
  fromInventory: number;
  /** Units added to the cart, to be bought at checkout. */
  toCart: number;
};

/**
 * Decide the split for adding `want` units, given how many the client owns.
 * Pure — the caller performs the writes.
 */
export function splitOnAdd(want: number, owned: number): Allocation {
  const fromInventory = Math.max(0, Math.min(want, owned));
  return { fromInventory, toCart: want - fromInventory };
}

/**
 * Decide the split for removing `drop` units from a line, given how many of
 * that line came off the shelf. Cart units are released first.
 */
export function splitOnRemove(drop: number, qtyFromInventory: number, quantity: number): Allocation {
  const cartPortion = Math.max(0, quantity - qtyFromInventory);
  const toCart = Math.min(drop, cartPortion);
  return { toCart, fromInventory: drop - toCart };
}

/** Move `qty` units of a product from the client's inventory onto a project. */
export async function takeFromInventory(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
  qty: number
): Promise<void> {
  if (qty <= 0) return;

  const { data: row } = await supabase
    .from("client_inventory_items")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (!row) return;

  const left = row.quantity - qty;
  if (left > 0) {
    await supabase.from("client_inventory_items").update({ quantity: left }).eq("id", row.id);
  } else {
    // Nothing left on the shelf — drop the line rather than leaving a zero.
    await supabase.from("client_inventory_items").delete().eq("id", row.id);
  }
}

/** Put `qty` units of a product back on the client's shelf. */
export async function returnToInventory(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
  qty: number
): Promise<void> {
  if (qty <= 0) return;

  const { data: row } = await supabase
    .from("client_inventory_items")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (row) {
    await supabase
      .from("client_inventory_items")
      .update({ quantity: row.quantity + qty })
      .eq("id", row.id);
  } else {
    await supabase
      .from("client_inventory_items")
      .insert({ user_id: userId, product_id: productId, quantity: qty });
  }
}

/** Add or remove `delta` units of a cart line tagged with a project. */
export async function adjustCart(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
  projectId: string,
  delta: number
): Promise<void> {
  if (delta === 0) return;

  const { data: line } = await supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!line) {
    if (delta > 0) {
      await supabase.from("cart_items").insert({
        user_id: userId,
        product_id: productId,
        project_id: projectId,
        quantity: delta,
      });
    }
    return;
  }

  const next = line.quantity + delta;
  if (next > 0) {
    await supabase.from("cart_items").update({ quantity: next }).eq("id", line.id);
  } else {
    await supabase.from("cart_items").delete().eq("id", line.id);
  }
}

/** How many of a product the client currently has on their shelf. */
export async function ownedCount(
  supabase: SupabaseClient,
  userId: string,
  productId: string
): Promise<number> {
  const { data } = await supabase
    .from("client_inventory_items")
    .select("quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();
  return data?.quantity ?? 0;
}
