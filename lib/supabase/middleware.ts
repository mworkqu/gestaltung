import { type NextRequest, type NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { hasSupabaseAuthCookie } from "./auth-cookie";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Defensive no-op: if Supabase isn't configured, don't take down the public
  // marketing site — just hand back next-intl's response untouched.
  if (!url || !anonKey) return response;

  if (!hasSupabaseAuthCookie(request.cookies.getAll().map((c) => c.name))) return response;

  const supabase = createServerClient(url, anonKey, {
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
  await supabase.auth.getUser();

  return response;
}
