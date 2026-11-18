"use server";

// CAD Champions sign-up (Prompt 2 Step C). Validated on the server with the
// same zod schema as the form (lib/cad-champions/auth/schema.ts).
//
// ccSignUp: supabase.auth.signUp with email + password. options.data carries
//   full_name + phone (the site's handle_new_user trigger fills
//   public.profiles from them; expected and harmless) AND `cc` = every CC
//   answer. With a session (email confirmation off) the cc_profiles row is
//   written now with the user's session; without one (confirmation on) it is
//   created on the first signed-in request by ensureCcProfile() (getCcUser).
//   A guest (anonymous session from the main site) is upgraded in place with
//   updateUser, exactly like the site's sign-up, so their work stays theirs.
// createCcProfile: an account that is already signed in (e.g. a main-site
//   account) but has no CC profile fills the same fields without email/password.

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { createRateLimiter, clientIp } from "@/lib/rate-limit";
import { ccCallbackUrl, ccContinueHref, safeCcNext } from "@/lib/cad-champions/auth/paths";
import { mapAuthError, type CcAuthErrorCode } from "@/lib/cad-champions/auth/errors";
import {
  ccProfileRow,
  checkProfile,
  checkSignUp,
  isProfileComplete,
  metadataProfile,
  type CcProfileFields,
} from "@/lib/cad-champions/auth/schema";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { markJourney } from "@/lib/cad-champions/journey/server";
import { isCcLocale } from "@/lib/cad-champions/routes";
import type { Locale } from "@/i18n/routing";

export type CcSignUpResult =
  | { ok: true; status: "signedIn"; redirectTo: string }
  | { ok: true; status: "checkEmail" }
  | { ok: false; fieldErrors?: Record<string, string>; error?: CcAuthErrorCode | "profileSave" | "notConfigured"; retryAfterSec?: number };

// A brake on scripted sign-ups (per server instance; Supabase has its own limits too).
const limiter = createRateLimiter({ limit: 8, windowMs: 10 * 60_000 });

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

async function insertProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fields: CcProfileFields,
  userId: string,
  email: string | null,
  locale: Locale,
): Promise<boolean> {
  const row = ccProfileRow(fields, userId, email, locale);
  const { error } = await supabase.from("cc_profiles").insert(row);
  // 23505 = the row exists already (double submit): fine.
  if (error && error.code !== "23505") {
    console.error("[cc-sign-up] profile insert failed:", error.code ?? error.message);
    return false;
  }
  if (isProfileComplete(row)) await markJourney(userId, "profile_completed_at");
  return true;
}

export async function ccSignUp(localeRaw: string, input: unknown): Promise<CcSignUpResult> {
  const locale: Locale = isCcLocale(localeRaw) ? localeRaw : "en";
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return { ok: false, error: "notConfigured" };
  }

  const ip = clientIp(await headers());
  const hit = limiter.hit(`cc-sign-up:${ip}`);
  if (!hit.allowed) return { ok: false, error: "rateLimited", retryAfterSec: hit.retryAfterSec };

  const parsed = checkSignUp(input);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.errors };
  const { email, password, captchaToken, next, profile } = parsed.data;

  const supabase = await createClient();
  const origin = await requestOrigin();
  const after = ccContinueHref(locale, next ?? null);
  const emailRedirectTo = ccCallbackUrl(origin, after);
  const data = { full_name: profile.fullName, phone: profile.phone, locale, cc: metadataProfile(profile, locale) };

  try {
    const {
      data: { user: existing },
    } = await supabase.auth.getUser();

    if (existing && existing.is_anonymous) {
      // Upgrade the guest in place (same auth.uid()); the email needs confirming.
      const { error } = await supabase.auth.updateUser({ email, password, data }, { emailRedirectTo });
      if (error) {
        const mapped = mapAuthError(error);
        return { ok: false, error: mapped.code, retryAfterSec: mapped.retryAfterSec };
      }
      return { ok: true, status: "checkEmail" };
    }

    const { data: res, error } = await supabase.auth.signUp({
      email,
      password,
      options: captchaToken ? { data, emailRedirectTo, captchaToken } : { data, emailRedirectTo },
    });
    if (error) {
      const mapped = mapAuthError(error);
      return { ok: false, error: mapped.code, retryAfterSec: mapped.retryAfterSec };
    }

    if (res.session && res.user) {
      const saved = await insertProfile(supabase, profile, res.user.id, res.user.email ?? email, locale);
      // Even if the insert failed, ensureCcProfile() retries on the next request.
      if (!saved) console.warn("[cc-sign-up] profile will be created on the next request");
      return { ok: true, status: "signedIn", redirectTo: after };
    }
    // Email confirmation on (or the address is already registered: Supabase
    // answers the same way on purpose). The check-email screen covers both.
    return { ok: true, status: "checkEmail" };
  } catch (e) {
    console.error("[cc-sign-up] failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "network" };
  }
}

export type CcCreateProfileResult =
  | { ok: true; redirectTo: string }
  | { ok: false; fieldErrors?: Record<string, string>; error?: "signedOut" | "profileSave" | "exists" };

/** For a signed-in account without a CC profile: create it from the form. */
export async function createCcProfile(localeRaw: string, input: unknown, next?: string | null): Promise<CcCreateProfileResult> {
  const locale: Locale = isCcLocale(localeRaw) ? localeRaw : "en";
  const cc = await getCcUser();
  if (!cc) return { ok: false, error: "signedOut" };
  if (cc.profile) return { ok: true, redirectTo: safeCcNext(next, locale) };

  const parsed = checkProfile(input);
  if (!parsed.ok) return { ok: false, fieldErrors: parsed.errors };

  const supabase = await createClient();
  const saved = await insertProfile(supabase, parsed.data, cc.user.id, cc.user.email ?? null, locale);
  if (!saved) return { ok: false, error: "profileSave" };
  return { ok: true, redirectTo: safeCcNext(next, locale) };
}
