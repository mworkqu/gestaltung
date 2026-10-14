import { NextResponse, type NextRequest } from "next/server";

import { ccSignInHref, ccSignUpHref, safeCcNext } from "@/lib/cad-champions/auth/paths";
import { getCcUser } from "@/lib/cad-champions/auth/server";
import { CC_LOCALE_COOKIE, CC_LOCALE_COOKIE_MAX_AGE, resolveCcLocale } from "@/lib/cad-champions/locale";
import { isCcLocale } from "@/lib/cad-champions/routes";

// Public URL /cad-champions/{locale}/auth/continue?next=… (middleware rewrites
// it here). Every CC sign-in ends here: password sign-in, the emailed sign-in
// link, a confirmed sign-up (via /api/auth/callback) and a password reset.
//  1. getCcUser() creates a missing cc_profiles row from the sign-up answers;
//  2. the language: profile.preferred_locale -> cc_locale cookie -> URL locale,
//     written to the cc_locale cookie so the middleware agrees from now on;
//  3. redirect to the safe `next` in that language (default: dashboard).
// Signed out -> sign-in; signed in without a CC profile -> sign-up to complete it.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const urlLocale = isCcLocale(raw) ? raw : "en";
  const next = request.nextUrl.searchParams.get("next");

  const cc = await getCcUser();
  const noStore = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

  if (!cc) {
    return NextResponse.redirect(new URL(ccSignInHref(urlLocale, next), request.url), { status: 303, headers: noStore });
  }

  const locale = resolveCcLocale({
    profileLocale: cc.profile?.preferred_locale ?? null,
    cookie: request.cookies.get(CC_LOCALE_COOKIE)?.value ?? urlLocale,
  });

  const target = !cc.profile && !cc.isStaff ? ccSignUpHref(locale, next) : safeCcNext(next, locale);
  const res = NextResponse.redirect(new URL(target, request.url), { status: 303, headers: noStore });
  res.cookies.set(CC_LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: CC_LOCALE_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
  return res;
}
