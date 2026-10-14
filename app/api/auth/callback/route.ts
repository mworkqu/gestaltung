import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { routing } from "@/i18n/routing";
import { handleClaimGuest } from "@/lib/auth/claim-guest";
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

// Only same-site paths. Anything else falls back to "/".
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  return raw;
}

function localeOf(next: string): string {
  const first = next.split("/")[1];
  return (routing.locales as readonly string[]).includes(first) ? first : routing.defaultLocale;
}

function signInError(origin: string, next: string, provider: OAuthProvider) {
  const params = new URLSearchParams({ oauth_error: provider });
  if (next !== "/") params.set("next", next);
  return NextResponse.redirect(`${origin}/${localeOf(next)}/sign-in?${params.toString()}`);
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
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
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  if (ok) {
    if (guestToken) await claimGuestAfterSocialSignIn(supabase, guestToken);
    return NextResponse.redirect(`${origin}${next}`);
  }

  if (provider) return signInError(origin, next, provider);

  // CAD Champions links (next = /cad-champions/{en|ar}/…): back to the CC
  // screens, not the site's. A reset link -> CC forgot-password, else CC sign-in.
  const cc = /^\/cad-champions\/(en|ar)(\/|$|\?)/.exec(next);
  if (cc) {
    const page = next.includes("reset-password") ? "forgot-password" : "sign-in";
    return NextResponse.redirect(`${origin}/cad-champions/${cc[1]}/${page}?expired=1`);
  }

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
