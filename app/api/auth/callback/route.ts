import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";

// Landing point for Supabase email links (password recovery). Supabase sends
// the user here with either a PKCE `code` or a `token_hash` + `type`; we turn
// it into a session cookie and forward them to `next` (a locale-prefixed path).
// Not under /[locale], so the i18n middleware leaves it alone.
export const dynamic = "force-dynamic";

// Only same-site paths. Anything else falls back to "/".
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"));
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();
  let ok = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  }

  if (ok) return NextResponse.redirect(`${origin}${next}`);

  // Expired or already-used link: send them back to request a fresh one.
  const first = next.split("/")[1];
  const locale = (routing.locales as readonly string[]).includes(first)
    ? first
    : routing.defaultLocale;
  return NextResponse.redirect(`${origin}/${locale}/forgot-password?expired=1`);
}
