// Turnstile in the browser (P2-08): an on-demand check for code that mints an
// anonymous session but has no widget of its own (add to cart, add to project,
// the emailed-link claim gate, …).
//
// <TurnstileChallenge enabled> (components/turnstile-challenge.tsx) registers
// itself here while it is mounted with the switch on and a site key. Until then
// requestTurnstileToken() answers null at once, and ensureSession() signs in
// exactly as before — so with the switch off nothing changes.

type Requester = () => Promise<string>;

let requester: Requester | null = null;

/** Called by <TurnstileChallenge>; pass null on unmount. Returns an unregister function. */
export function registerTurnstileRequester(r: Requester): () => void {
  requester = r;
  return () => {
    if (requester === r) requester = null;
  };
}

/** True while a challenge dialog is available on this page. */
export function turnstileChallengeAvailable(): boolean {
  return requester !== null;
}

/**
 * A fresh single-use token from the challenge dialog, or null when no dialog is
 * registered (switch off / no site key / page without one). Rejects with
 * Error("captcha_cancelled") if the visitor closes the dialog.
 */
export async function requestTurnstileToken(): Promise<string | null> {
  return requester ? requester() : null;
}
