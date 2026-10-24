import { RESET_TYPE } from "@/lib/auth/reset-token";
import type { createClient } from "@/lib/supabase/server";

// The one place that spends a recovery token (2026-10). Both routes into the
// reset page — the link's token hash and the 6-digit code — end here, and the
// token is spent and the password changed in the SAME request: verifyOtp gives
// this request a recovery session, updateUser writes the new password on it,
// signOut ends it so the visitor signs in normally with the new password.
//
// Nothing verifies on a page load, so a mail scanner's pre-fetch cannot spend
// the token (see docs/AUTH_EMAILS.md "Why the link changed").

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Either half of a recovery proof: the link's hash, or the emailed code. */
export type RecoveryProof = { tokenHash: string } | { email: string; code: string };

/** "expired" also covers a wrong code and an unknown address, so neither reveals whether an account exists. */
export type ResetOutcome = "ok" | "expired" | "failed";

export async function applyNewPassword(supabase: Supabase, proof: RecoveryProof, password: string): Promise<ResetOutcome> {
  const { error: verifyError } =
    "tokenHash" in proof
      ? await supabase.auth.verifyOtp({ type: RESET_TYPE, token_hash: proof.tokenHash })
      : await supabase.auth.verifyOtp({ type: RESET_TYPE, email: proof.email, token: proof.code });
  // Used, expired, wrong code, no such account: one answer for all of them.
  if (verifyError) return "expired";

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) return "failed";

  // The recovery session exists only to set the password.
  await supabase.auth.signOut();
  return "ok";
}
