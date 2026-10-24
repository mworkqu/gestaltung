"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { applyNewPassword, type RecoveryProof } from "@/lib/auth/reset-password-server";
import { parseOtpCode, parseTokenHash, passwordSchema } from "@/lib/auth/reset-token";
import { isPlausibleEmail } from "@/lib/email-address";
import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// Setting a new password. NOTHING happens on the GET of the page: these two
// actions are the only place a recovery token is spent, which is what makes the
// emailed link survive a mail scanner's pre-fetch.
//
// Never log a token, a hash, a code or a password.

export type ResetError =
  | "invalid"
  | "invalid_email"
  | "invalid_code"
  | "mismatch"
  | "weak_password"
  | "too_many"
  | "expired"
  | "failed";

export type ResetResult = { ok: true } | { ok: false; error: ResetError };

/**
 * A 6-digit code is guessable, so the code route is braked per IP and per
 * address (fixed window, per server instance — lib/rate-limit.ts). The link
 * route needs none: its hash is not enumerable.
 */
const codeAttempts = createRateLimiter({ limit: 8, windowMs: 15 * 60_000 });

const hashForm = z.object({ tokenHash: z.string(), password: z.string(), confirm: z.string() });
const codeForm = z.object({ email: z.string(), code: z.string(), password: z.string(), confirm: z.string() });

/** The two password fields, or the code to show for them. */
function checkPassword(password: string, confirm: string): ResetError | null {
  if (!passwordSchema.safeParse(password).success) return "weak_password";
  if (password !== confirm) return "mismatch";
  return null;
}

async function finish(proof: RecoveryProof, password: string): Promise<ResetResult> {
  const outcome = await applyNewPassword(await createClient(), proof, password);
  return outcome === "ok" ? { ok: true } : { ok: false, error: outcome };
}

/** The link route: `?token_hash=…` from the email, submitted with the new password. */
export async function resetPasswordWithHash(input: unknown): Promise<ResetResult> {
  const parsed = hashForm.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { password, confirm } = parsed.data;

  const tokenHash = parseTokenHash(parsed.data.tokenHash);
  // A malformed hash can only be a truncated or rewritten link.
  if (!tokenHash) return { ok: false, error: "expired" };

  const bad = checkPassword(password, confirm);
  if (bad) return { ok: false, error: bad };

  return finish({ tokenHash }, password);
}

/** The code route: the address the email went to plus its 6-digit code. */
export async function resetPasswordWithCode(input: unknown): Promise<ResetResult> {
  const parsed = codeForm.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { password, confirm } = parsed.data;

  const email = parsed.data.email.trim().toLowerCase();
  if (!isPlausibleEmail(email)) return { ok: false, error: "invalid_email" };

  const code = parseOtpCode(parsed.data.code);
  if (!code) return { ok: false, error: "invalid_code" };

  const bad = checkPassword(password, confirm);
  if (bad) return { ok: false, error: bad };

  const ip = clientIp(await headers());
  for (const key of [`ip:${ip}`, `email:${email}`]) {
    if (!codeAttempts.hit(key).allowed) return { ok: false, error: "too_many" };
  }

  return finish({ email, code }, password);
}
