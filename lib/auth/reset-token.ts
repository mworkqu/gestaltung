import { z } from "zod";

// What the emailed password-reset / confirm links carry (docs/AUTH_EMAILS.md).
//
// The templates link to `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=…`
// and also print the 6-digit `{{ .Token }}`. Nothing here talks to Supabase:
// the page parses the query with these helpers and the server action verifies
// only when the form is submitted, so a mail scanner that pre-fetches the link
// cannot spend the token.
//
// Pure on purpose (no Next / React / Supabase imports): unit-tested, and used
// by server pages, server actions and tests alike.

/**
 * Hours the emailed link and code stay valid. Supabase's "Email OTP
 * expiration" is set to 10800 s (docs/AUTH_EMAILS.md step 3) and the four
 * templates print the same sentence. Change it here, in Supabase and in the
 * templates together.
 */
export const OTP_VALID_HOURS = 3;

/** The email link types the app sends; anything else is refused. */
export const RESET_TYPE = "recovery" as const;
export const CONFIRM_TYPES = ["signup", "email_change"] as const;
export type ConfirmType = (typeof CONFIRM_TYPES)[number];

/**
 * Supabase's token hash: a URL-safe token, optionally with its `pkce_` prefix.
 * Length-capped so a huge query string is rejected before it reaches Supabase.
 */
const TOKEN_HASH_RE = /^[A-Za-z0-9_-]{16,512}$/;

export const tokenHashSchema = z.string().trim().regex(TOKEN_HASH_RE);
export const otpCodeSchema = z.string().regex(/^[0-9]{6}$/);

/** A password Supabase will accept: its own minimum is 6, bcrypt stops at 72 bytes. */
export const passwordSchema = z.string().min(6).max(72);

/** The `token_hash` query value, or null when it is missing or malformed. */
export function parseTokenHash(raw: unknown): string | null {
  const parsed = tokenHashSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The 6-digit code from the email, or null. Spaces are dropped first: people
 * paste "123 456" out of the mail client.
 */
export function parseOtpCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parsed = otpCodeSchema.safeParse(raw.replace(/\s+/gu, ""));
  return parsed.success ? parsed.data : null;
}

/** The `type` query value for /confirm-email, or null when we do not send it. */
export function parseConfirmType(raw: unknown): ConfirmType | null {
  return typeof raw === "string" && (CONFIRM_TYPES as readonly string[]).includes(raw) ? (raw as ConfirmType) : null;
}

/** True when the link is a password-recovery link (`type=recovery`). */
export function isResetType(raw: unknown): boolean {
  return raw === RESET_TYPE;
}
