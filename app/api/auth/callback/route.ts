import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { routing } from "@/i18n/routing";
import { handleClaimGuest } from "@/lib/auth/claim-guest";
import { callbackNextPath } from "@/lib/auth/next-path";
import { claimGuestDeps } from "@/lib/auth/claim-guest-server";
import { isLinkConflict, isOAuthProvider, oauthCallbackUrl, oauthScopes, type OAuthProvider } from "@/lib/auth/providers";

// Landing point for Supabase email links (password recovery) and social
// sign-in (Google / Apple / Microsoft). Supabase sends the user here with
// either a PKCE `code` or a `token_hash` + `type`; we turn it into a session
// cookie and forward them to `next` (a locale-prefixed path). Not under
// /[locale], so the i18n middleware leaves it alone.
//
// Social sign-in (`provider` in the query, set by components/auth/social-sign-in.tsx):
//  - error from the provider/Supabase → /{locale}/sign-in?oauth_error=<provider>
//  - a guest's linkIdentity hit an account that already exists (link=1 +
//    identity_already_exists) → start a plain sign-in for that provider here;
//  - after a plain sign-in, a guest session that was in the cookies before the
//    exchange has its work moved to the account (claim_guest_work, 0071), the
//    same step the email sign-in does via /api/auth/claim-guest.
export const dynamic = "force-dynamic";

/**
 * True when the browser sent the PKCE code verifier that the exchange needs.
 * The browser client (createBrowserClient) stores it in a cookie named
 * sb-<ref>-auth-token-code-verifier; if it is missing here, the verifier was
 * lost between starting the sign-in and coming back (a different browser,
 * cookies cleared, or an in-app browser handing off to the real one).
 */
function hasVerifierCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => c.name.endsWith("-code-verifier"));
}

function localeOf(next: string): string {
  const first = next.split("/")[1];
  return (routing.locales as readonly string[]).includes(first) ? first : routing.defaultLocale;
}

function signInError(origin: string, next: string, provider: OAuthProvider, reason?: string | null) {
  const params = new URLSearchParams({ oauth_error: provider });
  if (next !== "/") params.set("next", next);
  // A short diagnostic code in the URL (no secrets): on a phone there is no
  // console and the Hobby plan keeps no runtime logs, so this is the only way
  // to see WHY a sign-in bounced back. The page still shows the plain message.
  if (reason) params.set("e", reason.slice(0, 48).replace(/[^a-zA-Z0-9_.:-]/g, "_"));
  return NextResponse.redirect(`${origin}/${localeOf(next)}/sign-in?${params.toString()}`);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  // Locale-prefixed same-site path only (lib/auth/next-path.ts); "/" otherwise.
  const next = callbackNextPath(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawProvider = searchParams.get("provider");
  const provider = isOAuthProvider(rawProvider) ? rawProvider : null;

  const supabase = await createClient();

  if (provider) {
    const error = searchParams.get("error") ?? searchParams.get("error_code");
    if (error) {
      // A guest tried to link a Google/Apple/Microsoft account that is already
      // someone's login: sign in to that account instead (the guest cookie
      // stays, so the claim below runs when they come back).
      if (searchParams.get("link") === "1" && isLinkConflict(searchParams.get("error_code"), searchParams.get("error_description"))) {
        const { data, error: startError } = await supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: oauthCallbackUrl(origin, next, provider), scopes: oauthScopes(provider), skipBrowserRedirect: true },
        });
        if (!startError && data?.url) return NextResponse.redirect(data.url);
      }
      console.warn("[auth-callback] social sign-in failed:", provider, searchParams.get("error_code") ?? error);
      return signInError(origin, next, provider);
    }
  }

  // The guest session in the cookies BEFORE the exchange replaces it (social
  // sign-in only). Only its token is kept, in memory; handleClaimGuest verifies
  // it server-side and checks it is anonymous.
  let guestToken: string | null = null;
  if (provider && code) {
    try {
      const { data } = await supabase.auth.getSession();
      guestToken = data.session?.access_token ?? null;
    } catch {
      guestToken = null;
    }
  }

  let ok = false;
  let failReason: string | null = null;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    if (error) failReason = `${error.code ?? error.name}${hasVerifierCookie(request) ? "" : ".noverifier"}`;
    // Why a social sign-in bounced back to /sign-in. Without this the exchange
    // failure is silent and the visitor only sees "that did not work".
    // Codes and messages only - never the code, the verifier or a token.
    if (error) {
      console.warn(
        "[auth-callback] code exchange failed:",
        JSON.stringify({
          provider: provider ?? "none",
          link: searchParams.get("link") === "1",
          hadGuestSession: guestToken !== null,
          hadVerifierCookie: hasVerifierCookie(request),
          status: error.status ?? null,
          code: error.code ?? null,
          name: error.name,
          message: error.message,
        })
      );
    }
  } else if (tokenHash && type) {
    // LEGACY, REMOVE AFTER 2026-10-31 (7 days after deploy). Email links now
    // go straight to /{locale}/reset-password and /{locale}/confirm-email,
    // which verify only on submit; this GET path spends the token on load, so a
    // mail scanner's pre-fetch burns it. It stays only for emails already sitting
    // in inboxes. When it goes, drop `tokenHash` / `type` and the
    // /{locale}/reset-password exception in callbackNextPath too; the `code`
    // path (social sign-in) stays.
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
    if (error) failReason = error.code ?? error.name;
  } else if (provider) {
    failReason = "nocode";
    console.warn(
      "[auth-callback] social sign-in came back with no code:",
      JSON.stringify({ provider, params: [...searchParams.keys()] })
    );
  }

  // A one-time code can only be spent once. If the browser fetched this URL
  // twice (a prefetch, a retried request), the first fetch signed the visitor
  // in and the second finds the code already used - bouncing them to /sign-in
  // while they are in fact signed in. Trust the cookies over the exchange.
  if (!ok && code) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && !user.is_anonymous) {
      ok = true;
      guestToken = null; // the first request already did the claim
    }
  }

  if (ok) {
    if (guestToken) await claimGuestAfterSocialSignIn(supabase, guestToken);
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (provider) return signInError(origin, next, provider, failReason);

  // Expired or already-used link: send them back to request a fresh one.
  return NextResponse.redirect(`${origin}/${localeOf(next)}/forgot-password?expired=1`);
}

// Same rules as POST /api/auth/claim-guest. A linked guest (same user id) is
// "same_user" and a signed-in account is "not_guest": both are no-ops. Never
// throws; a failure is logged without the token.
async function claimGuestAfterSocialSignIn(supabase: Awaited<ReturnType<typeof createClient>>, token: string) {
  try {
    const service = createServiceClient();
    if (!service) return;
    const out = await handleClaimGuest({ token }, claimGuestDeps(supabase, service));
    const reason = out.body.error;
    if (out.status !== 200 && reason !== "same_user" && reason !== "not_guest" && reason !== "invalid_token") {
      console.error("[auth-callback] guest claim failed:", out.status, String(reason ?? ""));
    }
  } catch (e) {
    console.error("[auth-callback] guest claim failed:", e instanceof Error ? e.message : "unknown");
  }
}
