"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import { PART_ORDER_STATUSES } from "@/lib/parts/constants";

function safeLocale(formData: FormData): "en" | "ar" {
  return String(formData.get("locale")) === "ar" ? "ar" : "en";
}

async function requireSuperAdmin(locale: string) {
  const session = await getSessionContext();
  if (!session) redirect(`/${locale}/sign-in`);
  if (session.profile.role !== "super_admin") redirect(`/${locale}/dashboard`);
}

export async function updateOrderStatus(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(PART_ORDER_STATUSES as readonly string[]).includes(status)) return;

  const supabase = await createClient();
  await supabase.from("part_orders").update({ status }).eq("id", id);

  revalidatePath(`/${locale}/dashboard/store/orders`);
  revalidatePath(`/${locale}/dashboard/store/orders/${id}`);
}

export async function toggleWhatsappSent(formData: FormData): Promise<void> {
  const locale = safeLocale(formData);
  await requireSuperAdmin(locale);

  const id = String(formData.get("id") ?? "");
  const next = formData.get("whatsapp_sent") === "true";
  if (!id) return;

  const supabase = await createClient();
  await supabase.from("part_orders").update({ whatsapp_sent: next }).eq("id", id);

  revalidatePath(`/${locale}/dashboard/store/orders`);
  revalidatePath(`/${locale}/dashboard/store/orders/${id}`);
}
