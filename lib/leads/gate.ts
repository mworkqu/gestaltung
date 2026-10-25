// The Turnstile gate in front of /api/store-lead.

import { leadAllowedFor } from "@/lib/lead-gate";
import { createClient } from "@/lib/supabase/server";
import { checkTurnstile, turnstileEnforced } from "@/lib/turnstile-server";

/**
 * Cloudflare Turnstile (P2-08). Switch off or a key missing → always allowed
 * (today's behaviour). Switch on → the x-turnstile-token header or the body's
 * turnstileToken must pass siteverify, UNLESS the caller is a signed-in,
 * NON-anonymous account (sign-up is itself CAPTCHA-checked). A guest
 * (anonymous) session is not exempt; the in-workspace forms (bom_quote,
 * studio_quote, print_request, drawing_request) ask the page's challenge
 * dialog for a token. The decision itself is lib/lead-gate.ts.
 */
export async function leadAllowed(request: Request, token: string | null): Promise<boolean> {
  const enforced = await turnstileEnforced();
  if (!enforced) return true;
  const tokenOk = !!token && (await checkTurnstile(request, token)).ok;
  if (tokenOk) return true;
  let user: { is_anonymous?: boolean | null } | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    return false;
  }
  return leadAllowedFor({ enforced, user, tokenOk });
}
