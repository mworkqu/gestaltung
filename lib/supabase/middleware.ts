import { type NextRequest, type NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Refreshes the Supabase auth session on every request and writes any rotated
// auth cookies onto the response that next-intl already produced. We DON'T
// create our own NextResponse here — we piggy-back on next-intl's so that
// /[locale] routing, the EN/AR switcher, and the locale cookie keep working.
export async function updateSession(
  request: NextRequest,
  response: NextResponse
): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Defensive no-op: if Supabase isn't configured, don't take down the public
  // marketing site — just hand back next-intl's response untouched.
  if (!url || !anonKey) return response;

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
