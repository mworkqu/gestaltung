"use server";

import { cookies } from "next/headers";

import {
  CC_CAD_EXPERIENCE,
  CC_CAD_SOFTWARE_USED,
  CC_COMPUTER_ACCESS,
  CC_LOCALES,
  CC_STUDY_LEVELS,
} from "@/lib/cad-champions/db/types";
import { CC_LOCALE_COOKIE_MAX_AGE, CC_LOCALE_COOKIE } from "@/lib/cad-champions/locale";
import { isCcTrack } from "@/lib/cad-champions/profile/track";
import { ccRateLimited } from "@/lib/cad-champions/rate-limits";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Account settings writes. Each action re-checks the session on the server.
// Things a student may change about themselves go through their own RLS client;
// deletion requests are written with the service client after the session check.

export type AccountError = "session" | "invalid" | "invalid_phone" | "save";
export type AccountResult = { ok: true } | { ok: false; error: AccountError };

async function currentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { supabase, user: null };
  return { supabase, user: data.user };
}

async function updateOwnProfile(values: Record<string, unknown>): Promise<AccountResult> {
  const { supabase, user } = await currentUser();
  if (!user) return { ok: false, error: "session" };
  const { error } = await supabase.from("cc_profiles").update(values).eq("id", user.id);
  if (error) {
    console.error("[cc account] profile update failed", error.message);
    return { ok: false, error: "save" };
  }
  return { ok: true };
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
}

export type DetailsInput = {
  fullName: string;
  fullNameAr: string;
  phone: string;
  studyLevel: string;
  cadSoftwareUsed: string;
  cadExperience: string;
  computer: string;
};

export async function saveDetails(input: DetailsInput): Promise<AccountResult> {
  const fullName = String(input.fullName ?? "").trim();
  const fullNameAr = String(input.fullNameAr ?? "").trim();
  const phoneRaw = String(input.phone ?? "").trim();
  if (fullName.length < 2 || fullName.length > 100 || fullNameAr.length > 100) return { ok: false, error: "invalid" };
  if (phoneRaw && !isValidPhone(phoneRaw)) return { ok: false, error: "invalid_phone" };

  // Empty choice = leave the column empty. A non-empty value must be one of the allowed ones.
  const pick = <T extends string>(list: readonly T[], v: string) => (v ? oneOf(list, v) : null);
  const studyLevel = pick(CC_STUDY_LEVELS, input.studyLevel);
  const cadSoftwareUsed = pick(CC_CAD_SOFTWARE_USED, input.cadSoftwareUsed);
  const cadExperience = pick(CC_CAD_EXPERIENCE, input.cadExperience);
  const computer = pick(CC_COMPUTER_ACCESS, input.computer);
  if (
    (input.studyLevel && !studyLevel) ||
    (input.cadSoftwareUsed && !cadSoftwareUsed) ||
    (input.cadExperience && !cadExperience) ||
    (input.computer && !computer)
  ) {
    return { ok: false, error: "invalid" };
  }

  return updateOwnProfile({
    full_name: fullName,
    full_name_ar: fullNameAr || null,
    phone: phoneRaw ? normalizePhone(phoneRaw) : null,
    study_level: studyLevel,
    cad_software_used: cadSoftwareUsed,
    cad_experience: cadExperience,
    has_windows_pc: computer,
  });
}

export async function saveLanguage(locale: string): Promise<AccountResult> {
  const next = oneOf(CC_LOCALES, locale);
  if (!next) return { ok: false, error: "invalid" };
  const result = await updateOwnProfile({ preferred_locale: next });
  if (!result.ok) return result;
  // The cookie keeps the middleware (which cannot query the database) in step with the profile.
  const jar = await cookies();
  jar.set(CC_LOCALE_COOKIE, next, {
    path: "/",
    maxAge: CC_LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return { ok: true };
}

export async function saveTrack(track: string): Promise<AccountResult> {
  if (!isCcTrack(track)) return { ok: false, error: "invalid" };
  return updateOwnProfile({ track_software: track });
}

export async function saveEmailPrefs(input: { weeklyProgressEmail: boolean; marketingConsent: boolean }): Promise<AccountResult> {
  return updateOwnProfile({
    weekly_progress_email: input.weeklyProgressEmail === true,
    marketing_consent: input.marketingConsent === true,
  });
}

// ------------------------------------------------------------ deletion

/** Create a pending deletion request. Writes with the service role after the session check. */
export async function requestAccountDeletion(): Promise<AccountResult> {
  const { user } = await currentUser();
  if (!user) return { ok: false, error: "session" };
  if (ccRateLimited("action", user.id)) return { ok: false, error: "save" };
  const service = createServiceClient();
  if (!service) {
    console.error("[cc account] service client unavailable");
    return { ok: false, error: "save" };
  }

  const insert = await service.from("cc_deletion_requests").insert({ user_id: user.id, status: "pending" });
  // 23505 = a pending request already exists (unique index): that is the state the student wants.
  if (insert.error && insert.error.code !== "23505") {
    console.error("[cc account] deletion request failed", insert.error.message);
    return { ok: false, error: "save" };
  }
  // The database trigger also stamps this; doing it here too keeps the page right even if the trigger is absent.
  const stamp = await service
    .from("cc_profiles")
    .update({ deletion_requested_at: new Date().toISOString() })
    .eq("id", user.id)
    .is("deletion_requested_at", null);
  if (stamp.error) console.error("[cc account] could not stamp deletion_requested_at", stamp.error.message);
  return { ok: true };
}

/** Withdraw a pending request. The row is kept (status rejected + note) as an audit trail. */
export async function cancelAccountDeletion(): Promise<AccountResult> {
  const { user } = await currentUser();
  if (!user) return { ok: false, error: "session" };
  const service = createServiceClient();
  if (!service) {
    console.error("[cc account] service client unavailable");
    return { ok: false, error: "save" };
  }

  const cancel = await service
    .from("cc_deletion_requests")
    .update({ status: "rejected", admin_note: "Cancelled by the student", processed_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("status", "pending");
  if (cancel.error) {
    console.error("[cc account] cancel deletion failed", cancel.error.message);
    return { ok: false, error: "save" };
  }
  const clear = await service.from("cc_profiles").update({ deletion_requested_at: null }).eq("id", user.id);
  if (clear.error) {
    console.error("[cc account] could not clear deletion_requested_at", clear.error.message);
    return { ok: false, error: "save" };
  }
  return { ok: true };
}
