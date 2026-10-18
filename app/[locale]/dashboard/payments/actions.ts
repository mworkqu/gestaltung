"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "../ai-costs/format";

// Admin payment controls. admin_payment_review / admin_pass_expire (0089)
// re-check super_admin and the status transition; we only pass the intent.

const ACTIONS = ["approve", "reject", "revoke", "check"] as const;
const VIEWS = ["review", "auto", "all"];

function back(locale: string, view: string, err: string | null) {
  const params = new URLSearchParams({ view: VIEWS.includes(view) ? view : "review", ...(err ? { err } : { done: "1" }) });
  return `/${locale}/dashboard/payments?${params.toString()}`;
}

async function guard() {
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");
}

export async function reviewPayment(formData: FormData) {
  const locale = formData.get("locale") === "ar" ? "ar" : "en";
  const view = String(formData.get("view") ?? "review");
  await guard();

  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  if (!UUID_RE.test(id) || !(ACTIONS as readonly string[]).includes(action)) redirect(back(locale, view, "failed"));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_payment_review", { p_payment: id, p_action: action, p_note: note || null });
  revalidatePath(`/${locale}/dashboard/payments`);
  revalidatePath(`/${locale}/dashboard/ai-costs`);
  redirect(back(locale, view, error ? "failed" : null));
}

export async function expirePass(formData: FormData) {
  const locale = formData.get("locale") === "ar" ? "ar" : "en";
  const view = String(formData.get("view") ?? "review");
  await guard();

  const user = String(formData.get("user") ?? "");
  if (!UUID_RE.test(user)) redirect(back(locale, view, "failed"));
  const note = String(formData.get("note") ?? "").trim().slice(0, 500);

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_pass_expire", { p_user: user, p_note: note || null });
  revalidatePath(`/${locale}/dashboard/payments`);
  revalidatePath(`/${locale}/dashboard/ai-costs`);
  redirect(back(locale, view, error ? "failed" : null));
}
