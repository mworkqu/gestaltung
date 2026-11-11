// CAD Champions response security headers (Prompt 12 Step A). Pure: the
// middleware's CC branch (middleware.ts handleCc) sets these on every CC page
// response, rewrites and redirects alike. They are CC-only on purpose: the
// site-wide header set (full CSP) is a separate owner decision, proposed in
// docs/cad-champions/SECURITY_REVIEW.md. HSTS is already sent by Vercel.
//
// - frame-ancestors 'none' + X-Frame-Options DENY: no site (this one included)
//   may frame a CC page (clickjacking on the test workspace, payments, admin).
//   No CC page frames another CC page. The one exception is the public shared
//   result (/results/share/<token>), which a student may embed elsewhere: it
//   gets no frame restriction.
//   CC pages may still embed others (Bunny / YouTube players); that is the
//   frame-src side, which this header does not restrict.
// - Only the frame-ancestors directive is sent as CSP, so scripts, styles and
//   media keep loading exactly as before (the full CSP is proposed, not applied).
// - X-Robots-Tag is NOT set here: the middleware keeps its own noindex header.

export const CC_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": "frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

const FRAME_HEADERS = ["Content-Security-Policy", "X-Frame-Options"];

/** True for the CC paths (after the locale) that may be framed by other sites. */
export function ccFramingAllowed(rest: string | undefined): boolean {
  return !!rest && /^\/results\/share\/[^/]+\/?$/.test(rest);
}

/**
 * Sets the CC security headers on a response's headers (overwrites same-named
 * ones). `rest` is the CC path after the locale ("/results/share/abc"); the
 * share page keeps referrer/nosniff/permissions but drops the frame headers.
 */
export function applyCcSecurityHeaders(headers: Headers, rest?: string): Headers {
  const framable = ccFramingAllowed(rest);
  for (const [name, value] of Object.entries(CC_SECURITY_HEADERS)) {
    if (framable && FRAME_HEADERS.includes(name)) headers.delete(name);
    else headers.set(name, value);
  }
  return headers;
}
