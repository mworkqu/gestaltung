import { type NextRequest, type NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { hasSupabaseAuthCookie, supabaseAuthCookieNames } from "./auth-cookie";
import { supabaseCookieOptions } from "./cookie-options";
import { supabaseEnv } from "./env";

// Refreshes the Supabase auth session and writes any rotated auth cookies onto
// the response that next-intl already produced. We DON'T create our own
// NextResponse here — we piggy-back on next-intl's so that /[locale] routing
// and the EN/AR switcher keep working.
//
// Phase G: an anonymous visitor (no sb-…-auth-token cookie) is skipped
// entirely — no Supabase client, no getUser(), never a Set-Cookie — so their
// responses stay cacheable and pay no auth latency. A visitor with a session
// (a signed-in user or a guest) still gets the refresh, and a rotated token
// comes back as Set-Cookie on that one response.
export async function updateSession(
  request: NextRequest,
  response: NextResponse
): Promise<NextResponse> {
  // Defensive no-op: if Supabase isn't configured, don't take down the public
  // marketing site — just hand back next-intl's response untouched.
  const env = supabaseEnv();
  if (!env) return response;
  const { url, anonKey } = env;

  if (!hasSupabaseAuthCookie(request.cookies.getAll().map((c) => c.name))) return response;

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: supabaseCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // IMPORTANT: getUser() revalidates the token server-side and triggers a
  // refresh when the access token has expired. Do not remove.
  //
  // It THROWS when the refresh token is gone (revoked, already rotated by a
  // parallel tab, or left over from a reset database): AuthApiError
  // "Invalid Refresh Token: Refresh Token Not Found". Unhandled, that error
  // escapes the middleware and takes down an ordinary page request. The
  // session is simply dead, so treat it as signed-out: drop the stale cookies
  // and let the page render for an anonymous visitor. Without clearing them
  // the browser keeps sending the dead token and every request repeats this.
  try {
    await supabase.auth.getUser();
  } catch (e) {
    const code = isObj(e) && typeof e.code === "string" ? e.code : "";
    const status = isObj(e) && typeof e.status === "number" ? e.status : 0;
    const dead = code === "refresh_token_not_found" || code === "refresh_token_already_used" || status === 400;
    if (!dead) throw e;
    for (const name of supabaseAuthCookieNames(request.cookies.getAll().map((c) => c.name))) {
      request.cookies.delete(name);
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
