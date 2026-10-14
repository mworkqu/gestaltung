// CAD Champions response security headers (Prompt 12 Step A). Pure: the
// middleware's CC branch (middleware.ts handleCc) sets these on every CC page
// response, rewrites and redirects alike. They are CC-only on purpose: the
// site-wide header set (full CSP, HSTS) is a separate owner decision, proposed
// in docs/cad-champions/SECURITY_REVIEW.md.
//
// - frame-ancestors 'self' + X-Frame-Options SAMEORIGIN: no other site may
//   frame a CC page (clickjacking on the test workspace, payments, admin).
//   CC pages may still embed others (Bunny / YouTube players); that is the
//   frame-src side, which this header does not restrict.
// - Only the frame-ancestors directive is sent as CSP, so scripts, styles and
//   media keep loading exactly as before.
// - X-Robots-Tag is NOT set here: the middleware keeps its own noindex header.

export const CC_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": "frame-ancestors 'self'",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
});

/** Sets the CC security headers on a response's headers (overwrites same-named ones). */
export function applyCcSecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(CC_SECURITY_HEADERS)) headers.set(name, value);
  return headers;
}
