import { NextResponse, type NextRequest } from "next/server";

import { getSessionContext } from "@/lib/auth/get-session";
import {
  SITE_V2_PREVIEW_COOKIE,
  SITE_V2_PREVIEW_COOKIE_VALUE,
  parsePreviewRequest,
  previewCookieOptions,
  previewRedirectPath,
} from "@/lib/site-v2";

// site_v2 preview (P3-03). super_admin only. While store_settings.site_v2 is
// OFF, /:locale/v2… answers 404 unless the browser carries site_v2=1; this
// route sets that cookie (7 days, httpOnly) and 303s to /<locale>/v2.
//   GET /api/admin/site-v2-preview?locale=ar   → cookie on, go to /ar/v2
//   GET /api/admin/site-v2-preview?on=0        → cookie cleared, go to /en
// The cookie is only ever set here — never on a public page.

export const dynamic = "force-dynamic";

const NO_STORE = "private, no-store, max-age=0";

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") {
    return new Response(null, { status: 403, headers: { "Cache-Control": NO_STORE } });
  }

  const preview = parsePreviewRequest(request.nextUrl.searchParams);
  const res = NextResponse.redirect(new URL(previewRedirectPath(preview), request.url), 303);
  res.headers.set("Cache-Control", NO_STORE);
  const cookie = previewCookieOptions(process.env.NODE_ENV === "production");
  if (preview.on) {
    res.cookies.set(SITE_V2_PREVIEW_COOKIE, SITE_V2_PREVIEW_COOKIE_VALUE, cookie);
  } else {
    res.cookies.set(SITE_V2_PREVIEW_COOKIE, "", { ...cookie, maxAge: 0 });
  }
  return res;
}
