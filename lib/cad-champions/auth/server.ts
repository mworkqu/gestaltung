// CAD Champions auth on the server — SERVER ONLY (server components, server
// actions, route handlers). Other CC pages code against this contract:
//
//   getCcUser()                        -> CcUser | null   (null = signed out or anonymous guest)
//   requireCcUser(locale, currentPath) -> CcUser, or redirect() to sign-in (?next=currentPath)
//   requireCcStaff(locale, currentPath)-> CcUser with role instructor|admin, else /dashboard?denied=1
//   requireCcAdmin(locale, currentPath)-> CcUser with role admin, else /dashboard?denied=1
//   getCcProfileOrNull(userId)         -> CcProfile | null (RLS: own row, or staff)
//   ensureCcProfile(user)              -> creates the cc_profiles row from sign-up metadata if missing
//
// Role = "admin" when the site profile is super_admin (public.profiles.role),
// else cc_profiles.role. Everything degrades gracefully before migration 0077
// has run (profile null, role null — never a crash).

import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";

import type { CcProfile, CcRole } from "../db/types";
import { markJourney } from "../journey/server";
import { ccPath } from "../routes";
import { ccSignInHref, ccSignUpHref } from "./paths";
import { ccProfileRow, isProfileComplete, readMetadataProfile } from "./schema";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/auth/server.ts is server-only");

export type CcUser = {
  user: User;
  profile: CcProfile | null;
  role: CcRole | null;
  /** instructor or admin */
  isStaff: boolean;
  isAdmin: boolean;
};

type Supa = Awaited<ReturnType<typeof createClient>>;

function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

/** Postgres / PostgREST "table does not exist" (migration not run yet). */
function isMissingTable(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

async function readProfile(supabase: Supa, userId: string): Promise<CcProfile | null> {
  const { data, error } = await supabase.from("cc_profiles").select("*").eq("id", userId).maybeSingle<CcProfile>();
  if (error) {
    if (!isMissingTable(error.code)) console.error("[cc-auth] profile read failed:", error.code ?? error.message);
    return null;
  }
  return data ?? null;
}

/** The signed-in user's CC profile (RLS: own row; staff read all). Null when missing or on error. */
export async function getCcProfileOrNull(userId: string): Promise<CcProfile | null> {
  if (!userId || !supabaseConfigured()) return null;
  try {
    return await readProfile(await createClient(), userId);
  } catch (e) {
    console.error("[cc-auth] profile read failed:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

/**
 * Creates the cc_profiles row from the answers saved at sign-up
 * (user_metadata.cc) when it is missing — the email-confirmation case, where
 * signUp returns no session so the row could not be written then. Uses the
 * user's own session (RLS allows inserting one's own row with role student).
 * Returns the profile, or null when there is nothing to create from.
 */
export async function ensureCcProfile(user: User, supabase?: Supa): Promise<CcProfile | null> {
  if (!user || user.is_anonymous) return null;
  const saved = readMetadataProfile((user.user_metadata as Record<string, unknown> | undefined)?.cc);
  if (!saved) return null;
  try {
    const client = supabase ?? (await createClient());
    const row = ccProfileRow(saved.fields, user.id, user.email ?? null, saved.locale);
    const { data, error } = await client.from("cc_profiles").insert(row).select("*").maybeSingle<CcProfile>();
    if (error) {
      // 23505: created meanwhile by another request — read it back.
      if (error.code === "23505") return await readProfile(client, user.id);
      if (!isMissingTable(error.code)) console.error("[cc-auth] profile create failed:", error.code ?? error.message);
      return null;
    }
    if (data && isProfileComplete(row)) await markJourney(user.id, "profile_completed_at");
    return data ?? null;
  } catch (e) {
    console.error("[cc-auth] profile create failed:", e instanceof Error ? e.message : "unknown");
    return null;
  }
}

async function siteIsSuperAdmin(supabase: Supa, userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle<{ role: string }>();
  if (error) return false;
  return data?.role === "super_admin";
}

/**
 * The current CC user, or null when signed out, an anonymous guest, or
 * Supabase is not configured. Memoised per request (React cache), so the
 * layout, header and page share one lookup.
 */
export const getCcUser = cache(async (): Promise<CcUser | null> => {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.is_anonymous) return null;

    const [profileRead, superAdmin] = await Promise.all([readProfile(supabase, user.id), siteIsSuperAdmin(supabase, user.id)]);
    const profile = profileRead ?? (await ensureCcProfile(user, supabase));

    const role: CcRole | null = superAdmin ? "admin" : (profile?.role ?? null);
    return {
      user,
      profile,
      role,
      isStaff: role === "admin" || role === "instructor",
      isAdmin: role === "admin",
    };
  } catch (e) {
    console.error("[cc-auth] getCcUser failed:", e instanceof Error ? e.message : "unknown");
    return null;
  }
});

export type RequireOptions = {
  /**
   * Allow a signed-in user who has no CC profile yet (e.g. a main-site
   * account). Default false: they are sent to sign-up to complete their CC
   * profile first. Staff always pass.
   */
  allowNoProfile?: boolean;
};

/**
 * The signed-in CC user, or a redirect: signed out -> sign-in (returning to
 * `currentPath`, a public CC path such as ccPath(locale, "/test")); no CC
 * profile -> sign-up (profile completion). Call at the top of every
 * protected page / server action.
 */
export async function requireCcUser(locale: Locale, currentPath: string, opts: RequireOptions = {}): Promise<CcUser> {
  const cc = await getCcUser();
  if (!cc) redirect(ccSignInHref(locale, currentPath));
  if (!cc.profile && !cc.isStaff && !opts.allowNoProfile) redirect(ccSignUpHref(locale, currentPath));
  return cc;
}

/** The dashboard with ?denied=1 (the page shows a "you don't have access" toast). */
export function ccDeniedHref(locale: Locale): string {
  return `${ccPath(locale, "/dashboard")}?denied=1`;
}

/** Instructor or admin, else redirect (sign-in when signed out, dashboard?denied=1 otherwise). */
export async function requireCcStaff(locale: Locale, currentPath: string): Promise<CcUser> {
  const cc = await getCcUser();
  if (!cc) redirect(ccSignInHref(locale, currentPath));
  if (!cc.isStaff) redirect(ccDeniedHref(locale));
  return cc;
}

/** Admin only, else redirect (sign-in when signed out, dashboard?denied=1 otherwise). */
export async function requireCcAdmin(locale: Locale, currentPath: string): Promise<CcUser> {
  const cc = await getCcUser();
  if (!cc) redirect(ccSignInHref(locale, currentPath));
  if (!cc.isAdmin) redirect(ccDeniedHref(locale));
  return cc;
}
