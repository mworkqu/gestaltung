// Editing a row of "My inventory" (P0-07 / audit #60). Pure.

export const MAX_INVENTORY_QUANTITY = 100000;

/**
 * A typed quantity as a whole number from 1 to MAX_INVENTORY_QUANTITY, or null
 * when it is not one. Zero is not a quantity: removing an item is the Delete
 * button's job (with its own confirmation), never a side effect of typing 0.
 */
export function parseInventoryQuantity(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= MAX_INVENTORY_QUANTITY ? n : null;
}

/** What to save for an edited row, or the reason it can't be saved yet. */
export function inventoryEdit(
  input: { name: string; quantity: string },
  row: { custom: boolean }
): { ok: true; quantity: number; name: string | null } | { ok: false; error: "quantity" | "name" } {
  const quantity = parseInventoryQuantity(input.quantity);
  if (quantity === null) return { ok: false, error: "quantity" };
  if (!row.custom) return { ok: true, quantity, name: null };
  const name = input.name.trim();
  return name ? { ok: true, quantity, name } : { ok: false, error: "name" };
}
