"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { REVIEW_STATUSES } from "@/lib/reviews/reviews";

// The locale and tab come from hidden form fields (attacker-controllable): pin
// both to known values so they can never steer revalidatePath / redirect.
function safeLocale(formData: FormData): "en" | "ar" {
  return String(formData.get("locale")) === "ar" ? "ar" : "en";
}

// Approve / reject / send back to pending (P4-03). set_review_status (0058)
// re-checks super admin and raises 'forbidden'; the role check here fails fast.
// Approved reviews show on the public pages through cached reads (tag "parts"),
// so the storefront cache is refreshed right away.
export async function setReviewStatus(formData: FormData) {
  const locale = safeLocale(formData);
  const id = String(formData.get("id") ?? "");
  const requested = String(formData.get("status") ?? "");
  const status = REVIEW_STATUSES.find((s) => s === requested);
  const tab = REVIEW_STATUSES.find((s) => s === String(formData.get("tab") ?? "")) ?? "pending";
  if (!id || !status) return;

  const session = await getSessionContext();
  if (!session || session.profile.role !== "super_admin") return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_review_status", { p_review: id, p_status: status });
  if (error) {
    console.error(`[reviews] set_review_status ${id} ${status}: ${error.message}`);
    redirect(`/${locale}/dashboard/reviews?status=${tab}&err=1`);
  }

  revalidateStorefront();
  revalidatePath(`/${locale}/dashboard/reviews`);
}
