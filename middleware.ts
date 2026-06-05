import createMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";

import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";

const handleI18nRouting = createMiddleware(routing);

export default async function middleware(request: NextRequest) {
  // 1) Run next-intl first so /[locale] routing + the EN/AR switcher decide the
  //    response (redirects, rewrites, locale cookie) exactly as before.
  const response = handleI18nRouting(request);

  // 2) Refresh the Supabase session, writing rotated auth cookies onto that
  //    same response. Order matters: intl owns the response, auth augments it.
  return updateSession(request, response);
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
