// CAD Champions sign-up / profile validation (pure, zod; tested in schema.test.ts).
// The SAME schema runs in the browser (instant field errors) and in the server
// actions (the only check that counts). Error messages are message KEYS under
// CC.auth.errors.*, never prose.
//
// Field names are camelCase (form side); ccProfileRow() maps them to the
// cc_profiles columns (lib/cad-champions/db/types.ts).

import { z } from "zod";

import type { Locale } from "@/i18n/routing";
import { isValidPhone, normalizePhone } from "@/lib/phone";

import {
  CC_CAD_EXPERIENCE,
  CC_CAD_SOFTWARE_USED,
  CC_COMPUTER_ACCESS,
  CC_STUDY_LEVELS,
  type CcProfile,
} from "../db/types";
import { checkPassword } from "../profile/password";
import { defaultTrackFor, type CcTrack } from "../profile/track";

// ── Option lists (labels: CC.auth.options.<list>.<key>) ─────────────────────

/** Common Qatar institutions. [TODO-MO: confirm institution list] */
export const CC_INSTITUTIONS = [
  "qu",
  "hbku",
  "udst",
  "tamuq",
  "cmuq",
  "gu_q",
  "nu_q",
  "vcuarts_q",
  "qatar_academy",
  "secondary_school",
  "other",
] as const;
export type CcInstitution = (typeof CC_INSTITUTIONS)[number];

export { CC_STUDY_LEVELS, CC_CAD_SOFTWARE_USED, CC_CAD_EXPERIENCE, CC_COMPUTER_ACCESS };

/** Under this age (in Asia/Qatar) a guardian's consent is required. */
export const CC_ADULT_AGE = 18;
/** Plausibility bounds for a date of birth. */
export const CC_MIN_AGE = 8;
export const CC_MAX_AGE = 100;

// ── Dates (Asia/Qatar) ──────────────────────────────────────────────────────

/** Today's calendar date in Qatar as "YYYY-MM-DD". */
export function qatarToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Qatar", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A real calendar date "YYYY-MM-DD" (no 2026-02-30). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Whole years between `dob` and today in Qatar, or null for a bad date. */
export function ageOn(dob: string, now: Date = new Date()): number | null {
  if (!isIsoDate(dob)) return null;
  const [ty, tm, td] = qatarToday(now).split("-").map(Number);
  const [y, m, d] = dob.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

/** Under 18 today in Qatar. A bad or missing date counts as not a minor (the schema rejects it anyway). */
export function isMinorDob(dob: string | null | undefined, now: Date = new Date()): boolean {
  if (!dob) return false;
  const age = ageOn(dob, now);
  return age !== null && age < CC_ADULT_AGE;
}

// ── Schemas ─────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().max(max, { message: "tooLong" });
const requiredText = (max: number) => text(max).min(1, { message: "required" });

const phone = z
  .string()
  .trim()
  .min(1, { message: "required" })
  .refine((v) => isValidPhone(v), { message: "invalidPhone" })
  .transform((v) => normalizePhone(v));

const optionalPhone = z
  .string()
  .trim()
  .max(40, { message: "tooLong" })
  .optional()
  .default("");

const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { message: "required" });

/** Profile fields (everything except email/password). Booleans arrive as real booleans (JSON, not FormData). */
export const ccProfileFieldsSchema = z
  .object({
    fullName: requiredText(120).refine((v) => v.length >= 2, { message: "required" }),
    phone,
    institution: choice(CC_INSTITUTIONS),
    institutionOther: text(160).optional().default(""),
    studyLevel: choice(CC_STUDY_LEVELS),
    dateOfBirth: z.string().trim().min(1, { message: "required" }),
    guardianName: text(120).optional().default(""),
    guardianPhone: optionalPhone,
    guardianConsent: z.boolean().optional().default(false),
    cadSoftwareUsed: choice(CC_CAD_SOFTWARE_USED),
    cadExperience: choice(CC_CAD_EXPERIENCE),
    hasWindowsPc: choice(CC_COMPUTER_ACCESS),
    marketingConsent: z.boolean().optional().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.institution === "other" && !v.institutionOther) {
      ctx.addIssue({ code: "custom", path: ["institutionOther"], message: "institutionOther" });
    }
    if (!isIsoDate(v.dateOfBirth)) {
      ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "invalidDate" });
      return;
    }
    const age = ageOn(v.dateOfBirth);
    if (age === null || age < 0) {
      ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "dobFuture" });
      return;
    }
    if (age < CC_MIN_AGE || age > CC_MAX_AGE) {
      ctx.addIssue({ code: "custom", path: ["dateOfBirth"], message: "dobRange" });
      return;
    }
    if (age < CC_ADULT_AGE) {
      if (!v.guardianName) ctx.addIssue({ code: "custom", path: ["guardianName"], message: "guardianName" });
      if (!v.guardianPhone) ctx.addIssue({ code: "custom", path: ["guardianPhone"], message: "required" });
      else if (!isValidPhone(v.guardianPhone)) ctx.addIssue({ code: "custom", path: ["guardianPhone"], message: "invalidPhone" });
      if (!v.guardianConsent) ctx.addIssue({ code: "custom", path: ["guardianConsent"], message: "guardianConsent" });
    }
  });

export type CcProfileFieldsInput = z.input<typeof ccProfileFieldsSchema>;
export type CcProfileFields = z.output<typeof ccProfileFieldsSchema>;

const password = z
  .string()
  .max(72, { message: "tooLong" })
  .refine((v) => {
    const r = checkPassword(v);
    return r.length && r.number;
  }, { message: "passwordRules" });

/** Sign-up = account fields + profile fields. */
export const ccSignUpSchema = z.object({
  email: z.email({ message: "invalidEmail" }).max(254, { message: "tooLong" }),
  password,
  captchaToken: z.string().max(4096).optional().nullable(),
  next: z.string().max(1024).optional().nullable(),
  profile: ccProfileFieldsSchema,
});

export type CcSignUpInput = z.input<typeof ccSignUpSchema>;

type Check<T> = { ok: true; data: T } | { ok: false; errors: Record<string, string> };

function rawObj(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

/**
 * zod skips superRefine while a plain field is invalid, so the guardian /
 * "other" errors would only show after a second submit. This adds them from
 * the raw values, so every error shows at once.
 */
function crossFieldErrors(raw: unknown): Record<string, string> {
  const v = rawObj(raw);
  const out: Record<string, string> = {};
  const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string).trim() : "");
  if (v.institution === "other" && !str("institutionOther")) out.institutionOther = "institutionOther";
  const dob = str("dateOfBirth");
  if (dob && !isIsoDate(dob)) out.dateOfBirth = "invalidDate";
  if (isIsoDate(dob)) {
    const age = ageOn(dob);
    if (age === null || age < 0) out.dateOfBirth = "dobFuture";
    else if (age < CC_MIN_AGE || age > CC_MAX_AGE) out.dateOfBirth = "dobRange";
    else if (age < CC_ADULT_AGE) {
      if (!str("guardianName")) out.guardianName = "guardianName";
      if (!str("guardianPhone")) out.guardianPhone = "required";
      else if (!isValidPhone(str("guardianPhone"))) out.guardianPhone = "invalidPhone";
      if (v.guardianConsent !== true) out.guardianConsent = "guardianConsent";
    }
  }
  return out;
}

/** Validates the profile fields; every field error at once. */
export function checkProfile(raw: unknown): Check<CcProfileFields> {
  const r = ccProfileFieldsSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: { ...crossFieldErrors(raw), ...fieldErrors(r.error) } };
}

/** Validates a sign-up (account + profile); every field error at once. */
export function checkSignUp(raw: unknown): Check<z.output<typeof ccSignUpSchema>> {
  const r = ccSignUpSchema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, errors: { ...crossFieldErrors(rawObj(raw).profile), ...fieldErrors(r.error) } };
}

/** Field -> first error key ("required", "invalidPhone", …). Profile paths are flattened ("profile.phone" -> "phone"). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.filter((p) => p !== "profile").map(String);
    const key = path[0] ?? "_form";
    if (!(key in out)) out[key] = issue.message || "required";
  }
  return out;
}

// ── Mapping to storage ──────────────────────────────────────────────────────

export type CcProfileInsert = Pick<
  CcProfile,
  | "id"
  | "email"
  | "full_name"
  | "phone"
  | "institution"
  | "institution_other"
  | "study_level"
  | "date_of_birth"
  | "guardian_name"
  | "guardian_phone"
  | "guardian_consent"
  | "cad_software_used"
  | "track_software"
  | "cad_experience"
  | "has_windows_pc"
  | "preferred_locale"
  | "role"
  | "marketing_consent"
>;

/**
 * The cc_profiles insert row. is_minor and guardian_consent_at are set by the
 * table trigger (server clock); guardian fields are dropped for adults.
 * track_software is preselected from the software they use (onboarding can change it).
 */
export function ccProfileRow(fields: CcProfileFields, userId: string, email: string | null, locale: Locale): CcProfileInsert {
  const minor = isMinorDob(fields.dateOfBirth);
  const track: CcTrack = defaultTrackFor(fields.cadSoftwareUsed);
  return {
    id: userId,
    email: email ? email.toLowerCase() : null,
    full_name: fields.fullName,
    phone: fields.phone,
    institution: fields.institution,
    institution_other: fields.institution === "other" ? fields.institutionOther || null : null,
    study_level: fields.studyLevel,
    date_of_birth: fields.dateOfBirth,
    guardian_name: minor ? fields.guardianName || null : null,
    guardian_phone: minor && fields.guardianPhone ? normalizePhone(fields.guardianPhone) : null,
    guardian_consent: minor ? fields.guardianConsent === true : false,
    cad_software_used: fields.cadSoftwareUsed,
    track_software: track,
    cad_experience: fields.cadExperience,
    has_windows_pc: fields.hasWindowsPc,
    preferred_locale: locale,
    role: "student",
    marketing_consent: fields.marketingConsent === true,
  };
}

/** Every field the plan requires is present (then journey.profile_completed_at is stamped). */
export function isProfileComplete(row: Partial<CcProfileInsert> | null | undefined): boolean {
  if (!row) return false;
  const base =
    !!row.full_name &&
    !!row.phone &&
    !!row.institution &&
    !!row.study_level &&
    !!row.date_of_birth &&
    !!row.cad_software_used &&
    !!row.cad_experience &&
    !!row.has_windows_pc;
  if (!base) return false;
  if (row.institution === "other" && !row.institution_other) return false;
  if (isMinorDob(row.date_of_birth)) return !!row.guardian_name && !!row.guardian_phone && row.guardian_consent === true;
  return true;
}

/**
 * The sign-up answers kept in auth user_metadata.cc so the profile can be
 * created on the first signed-in request when email confirmation is on
 * (no session right after signUp). Read back with readMetadataProfile().
 */
export function metadataProfile(fields: CcProfileFields, locale: Locale): Record<string, unknown> {
  return { ...fields, locale, v: 1 };
}

/** Parses user_metadata.cc back into validated fields + locale, or null. */
export function readMetadataProfile(raw: unknown): { fields: CcProfileFields; locale: Locale } | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = ccProfileFieldsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const loc = (raw as { locale?: unknown }).locale;
  return { fields: parsed.data, locale: loc === "ar" ? "ar" : "en" };
}
