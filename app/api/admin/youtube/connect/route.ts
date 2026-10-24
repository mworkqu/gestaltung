import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/auth/get-session";
import { signState, STATE_TTL_MS } from "@/lib/integrations/crypto";
import { youtubeConfig } from "@/lib/integrations/youtube-server";
import { buildAuthUrl, redirectUriFor, STATE_COOKIE } from "@/lib/youtube-upload";
import { asLocale } from "@/lib/locale";
import { isSuperAdminSession } from "@/lib/auth/guards";
import { emptyStatus } from "@/lib/http";

// D6: start "Connect channel". super_admin only. Sets a signed, httpOnly state
// cookie (CSRF) scoped to the callback path and sends the browser to Google's
// consent screen (offline access, prompt=consent → a refresh token every time).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const locale = asLocale(request.nextUrl.searchParams.get("locale"));
  const back = (q: string) => NextResponse.redirect(new URL(`/${locale}/dashboard/store/youtube?${q}`, request.nextUrl.origin), 303);

  const session = await getSessionContext();
  if (!isSuperAdminSession(session)) return emptyStatus(403);

  const c = youtubeConfig();
  if (!c.ok) return back("yt=error&reason=setup");

  const state = signState(locale, c.cfg.key);
  const url = buildAuthUrl({
    clientId: c.cfg.clientId,
    redirectUri: redirectUriFor(request.nextUrl.origin),
    state,
  });
  const res = NextResponse.redirect(url, 303);
  res.headers.set("Cache-Control", "private, no-store");
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/admin/youtube",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
