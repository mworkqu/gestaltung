"use server";

import { revalidatePath } from "next/cache";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";

/** Hide one product from the store (e.g. the backup, once Voltaat has stock again). super_admin only. */
export async function hideProduct(formData: FormData): Promise<void> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return;
  const id = String(formData.get("id") ?? "");
  const locale = formData.get("locale") === "ar" ? "ar" : "en";
  if (!id) return;
  const db = await createClient();
  await db.from("parts").update({ is_published: false }).eq("id", id);
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/overview`);
}
