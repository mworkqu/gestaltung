// The browser reads and writes behind "My inventory" (components/inventory/my-inventory.tsx),
// moved out of the component unchanged (R11). Table `client_inventory_items`
// (the client's own list, NOT the workshop's inventory_items); RLS scopes every
// call to the signed-in user. Callers check for a real (non-guest) user first.

import { createClient } from "@/lib/supabase/client";
import { PROJECT_IMAGE_BUCKET } from "@/lib/projects/constants";
import { PART_PUBLIC_COLUMNS } from "@/lib/store/part-columns";
import type { ClientInventoryItem, Part } from "@/lib/supabase/types";

export type InventoryRow = ClientInventoryItem & { part: Part | null };

/** All of the caller's items with the public columns of their store product, newest first. */
export async function loadInventoryRows(): Promise<InventoryRow[]> {
  const { data } = await createClient()
    .from("client_inventory_items")
    .select(`*, part:parts(${PART_PUBLIC_COLUMNS})`)
    .order("created_at", { ascending: false });
  return (data ?? []) as InventoryRow[];
}

/** Add one of a store product: bumps the quantity when the user already has it, else inserts a row of 1. */
export async function addStoreProduct(userId: string, productId: string): Promise<void> {
  const supabase = createClient();

  const { data: existing } = await supabase
    .from("client_inventory_items")
    .select("id, quantity")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("client_inventory_items")
      .update({ quantity: existing.quantity + 1 })
      .eq("id", existing.id);
  } else {
    await supabase.from("client_inventory_items").insert({
      user_id: userId,
      product_id: productId,
      quantity: 1,
    });
  }
}

/** Save an edited row (quantity, and the name of a custom item when `name` is not null). True when saved. */
export async function saveInventoryRow(id: string, quantity: number, name: string | null): Promise<boolean> {
  const { error } = await createClient()
    .from("client_inventory_items")
    .update(name === null ? { quantity } : { quantity, custom_name: name })
    .eq("id", id);
  return !error;
}

/** Delete a row, then its photo (a failed row delete leaves the photo). True when the row was deleted. */
export async function deleteInventoryRow(id: string, imagePath: string | null): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.from("client_inventory_items").delete().eq("id", id);
  if (error) return false;
  if (imagePath) {
    await supabase.storage.from(PROJECT_IMAGE_BUCKET).remove([imagePath]);
  }
  return true;
}

/** Upload a photo for a custom item; the storage path, or null when the upload failed. */
export async function uploadInventoryImage(userId: string, file: File): Promise<string | null> {
  const ext = file.name.split(".").pop() ?? "png";
  const path = `${userId}/inventory/${crypto.randomUUID()}.${ext}`;
  const { error } = await createClient().storage.from(PROJECT_IMAGE_BUCKET).upload(path, file);
  return error ? null : path;
}

/** Insert a custom (not sold here) item. */
export async function insertCustomItem(userId: string, name: string, quantity: number, imagePath: string | null): Promise<void> {
  await createClient().from("client_inventory_items").insert({
    user_id: userId,
    custom_name: name,
    quantity,
    image_path: imagePath,
  });
}
