"use server";

import { z } from "zod";

import { safeNextPath } from "@/lib/auth/next-path";
import { parseConfirmType, parseTokenHash } from "@/lib/auth/reset-token";
import { asLocale } from "@/lib/locale";
import { createClient } from "@/lib/supabase/server";

// Confirming an email address (sign-up and email change). Like the password
// reset, the page's GET does nothing: this action is the only place the token
// is spent, so a mail scanner's pre-fetch cannot burn it.
//
// Never log a token or a hash.

export type ConfirmError = "invalid" | "expired" | "failed";
export type ConfirmResult = { ok: true; next: string } | { ok: false; error: ConfirmError };

const confirmForm = z.object({
  tokenHash: z.string(),
  type: z.string(),
  locale: z.string(),
  next: z.string().nullable().optional(),
});

export async function confirmEmail(input: unknown): Promise<ConfirmResult> {
  const parsed = confirmForm.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const tokenHash = parseTokenHash(parsed.data.tokenHash);
  if (!tokenHash) return { ok: false, error: "expired" };

  // Only the types the templates actually send (signup, email_change).
  const type = parseConfirmType(parsed.data.type);
  if (!type) return { ok: false, error: "invalid" };

  const locale = asLocale(parsed.data.locale);
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  // Used, expired or forged: one answer, and nothing about the account.
  if (error) return { ok: false, error: "expired" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "failed" };

  return { ok: true, next: safeNextPath(parsed.data.next ?? null, locale) ?? `/${locale}` };
}
