"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionContextCached } from "@/lib/auth/guards";
import { buildGrantNote, parseGrantReason, pickAmount } from "@/lib/credits/grant-reasons";
import { createClient } from "@/lib/supabase/server";
import { asLocale } from "@/lib/locale";

// Manual credit grant (bank transfer / WhatsApp top-ups until online payment
// exists). admin_grant() (0042) re-checks super_admin and the inputs.
export async function grantCredits(formData: FormData) {
  const locale = asLocale(formData.get("locale"));
  const s = await getSessionContextCached();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");

  const user = String(formData.get("user") ?? "");
  const q = String(formData.get("q") ?? "");
  const kind = formData.get("kind") === "cad" ? "cad" : "wiring";
  // D7: a quick button (+1/+3/+10, field "amount") wins over the custom field.
  const picked = pickAmount(formData.get("amount"), formData.get("customAmount"));
  const amount = Number.isNaN(picked) ? 0 : picked; // 0 → admin_grant answers bad_amount
  const note = buildGrantNote(parseGrantReason(formData.get("reason")), String(formData.get("note") ?? ""));

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant", { p_user: user, p_kind: kind, p_amount: amount, p_note: note });
  const code = error
    ? (["note_required", "bad_amount", "below_zero", "no_user"].find((c) => error.message.includes(c)) ?? "failed")
    : null;

  revalidatePath(`/${locale}/dashboard/credits`);
  const params = new URLSearchParams({ user, ...(q ? { q } : {}), ...(code ? { err: code } : { granted: "1" }) });
  redirect(`/${locale}/dashboard/credits?${params.toString()}`);
}
