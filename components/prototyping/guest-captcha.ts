// A Turnstile token for the calls a guest session makes without a widget of its
// own: /api/brief-chat, /api/transcribe and /api/store-lead (bom_quote,
// studio_quote, print_request, drawing_request). The server asks for one only
// from a guest (anonymous) session while the store_settings switch is on;
// everyone else sends nothing.
//
// The token comes from the page's <TurnstileChallenge> dialog (the same
// on-demand route IdeaStage uses for /api/analyse when its inline widget has no
// token). A dialog is registered only with the switch on and a site key, so
// "dialog available" already means "Turnstile is on". Tokens are single-use, so
// every call asks for a fresh one. With the switch off, a signed-in account or
// no dialog mounted, this answers null at once and the request is unchanged.

import { TURNSTILE_HEADER } from "@/lib/turnstile";
import { requestTurnstileToken, turnstileChallengeAvailable } from "@/lib/turnstile-client";
import { getCurrentUser, isGuest } from "@/lib/supabase/guest";

/**
 * A fresh token for a guest while the switch is on; null otherwise (or if the
 * visitor closes the dialog). Pass the page's `turnstileEnabled` where it is at
 * hand: `false` short-circuits before any lookup.
 */
export async function guestCaptchaToken(enabled = true): Promise<string | null> {
  if (!enabled || !turnstileChallengeAvailable()) return null;
  if (!isGuest(await getCurrentUser())) return null;
  return requestTurnstileToken().catch(() => null);
}

/** The request header carrying the token, or nothing. */
export function captchaHeaders(token: string | null): Record<string, string> {
  return token ? { [TURNSTILE_HEADER]: token } : {};
}
