"use server";

// Small CC auth server actions used by the shell (header account menu,
// language switcher). Each checks auth itself.

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { ccPath, isCcLocale } from "../routes";
import { getCcUser } from "./server";

/** Signs out (this device) and goes to the CC home in `locale`. */
export async function ccSignOut(locale: string): Promise<void> {
  const loc = isCcLocale(locale) ? locale : "en";
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("[cc-auth] sign-out failed:", e instanceof Error ? e.message : "unknown");
  }
  redirect(ccPath(loc, "/"));
}

/**
 * Saves the signed-in user's language (cc_profiles.preferred_locale).
 * Called by the language switcher next to the cc_locale cookie. No-op when
 * signed out or without a CC profile. Never throws.
 */
export async function setPreferredLocale(locale: string): Promise<{ ok: boolean }> {
  if (!isCcLocale(locale)) return { ok: false };
  const cc = await getCcUser();
  if (!cc?.profile) return { ok: false };
  if (cc.profile.preferred_locale === locale) return { ok: true };
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("cc_profiles").update({ preferred_locale: locale }).eq("id", cc.user.id);
    if (error) {
      console.error("[cc-auth] preferred_locale update failed:", error.code ?? error.message);
      return { ok: false };
    }
    return { ok: true };
  } catch (e) {
    console.error("[cc-auth] preferred_locale update failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false };
  }
}
