"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionContext } from "@/lib/auth/get-session";
import { createClient } from "@/lib/supabase/server";

// Manual credit grant (bank transfer / WhatsApp top-ups until online payment
// exists). admin_grant() (0042) re-checks super_admin and the inputs.
export async function grantCredits(formData: FormData) {
  const locale = formData.get("locale") === "ar" ? "ar" : "en";
  const s = await getSessionContext();
  if (s?.profile.role !== "super_admin") throw new Error("forbidden");

  const user = String(formData.get("user") ?? "");
  const q = String(formData.get("q") ?? "");
  const kind = formData.get("kind") === "cad" ? "cad" : "wiring";
  const amount = Math.trunc(Number(formData.get("amount")));
  const note = String(formData.get("note") ?? "").trim();

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_grant", { p_user: user, p_kind: kind, p_amount: amount, p_note: note });
  const code = error
    ? (["note_required", "bad_amount", "below_zero", "no_user"].find((c) => error.message.includes(c)) ?? "failed")
    : null;

  revalidatePath(`/${locale}/dashboard/credits`);
  const params = new URLSearchParams({ user, ...(q ? { q } : {}), ...(code ? { err: code } : { granted: "1" }) });
  redirect(`/${locale}/dashboard/credits?${params.toString()}`);
}
