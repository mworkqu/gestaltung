"use server";

import { revalidatePath } from "next/cache";

import { getSessionContextCached } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { asLocale } from "@/lib/locale";

/** Hide one product from the store (e.g. the backup, once Voltaat has stock again). super_admin only. */
export async function hideProduct(formData: FormData): Promise<void> {
  const session = await getSessionContextCached();
  if (session?.profile.role !== "super_admin") return;
  const id = String(formData.get("id") ?? "");
  const locale = asLocale(formData.get("locale"));
  if (!id) return;
  const db = await createClient();
  await db.from("parts").update({ is_published: false }).eq("id", id);
  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/store/overview`);
}
