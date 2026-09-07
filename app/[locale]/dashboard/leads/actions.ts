"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import type { InquiryStatus } from "@/lib/supabase/types";

const STATUSES: InquiryStatus[] = ["new", "contacted", "closed"];

// The locale comes from a hidden form field (attacker-controllable). Pin it to a
// known locale so it can never steer revalidatePath at a crafted path.
function safeLocale(formData: FormData): "en" | "ar" {
  return String(formData.get("locale")) === "ar" ? "ar" : "en";
}

// Move a lead through new -> contacted -> closed. RLS already limits updates to
// super_admin; the role check here fails fast rather than leaning on the policy
// alone, and pinning the status keeps a crafted form field out of the write.
export async function setLeadStatus(formData: FormData) {
  const locale = safeLocale(formData);
  const id = String(formData.get("id") ?? "");
  const requested = String(formData.get("status") ?? "");
  const status = STATUSES.find((s) => s === requested);
  if (!id || !status) return;

  const session = await getSessionContext();
  if (!session || session.profile.role !== "super_admin") return;

  const supabase = await createClient();
  await supabase.from("inquiries").update({ status }).eq("id", id);

  revalidatePath(`/${locale}/dashboard/leads`);
}
