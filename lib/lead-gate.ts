// The Turnstile decision for /api/store-lead (P2-08), kept pure so it can be
// tested without a request. Switch off (not enforced) = always allowed. Switch
// on = the visitor passed siteverify, or is a signed-in NON-anonymous account
// (sign-up is itself behind the CAPTCHA). A guest (anonymous Supabase session)
// is not exempt: minting that session is cheap and the endpoint sends email.

export function leadAllowedFor(input: {
  /** Switch on and both keys set (turnstileEnforced()). */
  enforced: boolean;
  /** The caller's verified Supabase user, or null with no session. */
  user: { is_anonymous?: boolean | null } | null;
  /** True when the posted token passed siteverify. */
  tokenOk: boolean;
}): boolean {
  if (!input.enforced) return true;
  if (input.tokenOk) return true;
  return !!input.user && input.user.is_anonymous !== true;
}
