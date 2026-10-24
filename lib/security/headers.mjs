// Security response headers for every route (audit WEB-03, SECURITY_REVIEW M5).
// Plain ESM so next.config.mjs can import it and vitest can test it.
//
// The CSP ships as Content-Security-Policy-Report-Only first: watch the
// console on Studio (WASM + workers), the Drive Picker, Turnstile and GA for
// one release, then rename the header to Content-Security-Policy.
//
// 'unsafe-inline' scripts: static/ISR pages carry inline Next RSC <script>
// blocks whose content changes per page and build, and nonces would need a
// per-request render, which public static pages must not do. A nonce policy
// for the already-dynamic areas is a later step. 'wasm-unsafe-eval' is needed
// by manifold-3d and the OpenSCAD engine; dev needs 'unsafe-eval' (React
// refresh) and the HMR socket.

/** @param {string | undefined} url */
function originOf(url) {
  try {
    return url ? new URL(url).origin : "";
  } catch {
    return "";
  }
}

/**
 * @typedef {{ supabaseUrl?: string, isDev?: boolean, isPreview?: boolean }} HeaderEnv
 */

/** @returns {Required<HeaderEnv>} */
function envDefaults() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    isDev: process.env.NODE_ENV !== "production",
    // The Vercel toolbar on preview deployments loads from vercel.live.
    isPreview: process.env.VERCEL_ENV === "preview",
  };
}

/**
 * @param {HeaderEnv} [env]
 * @returns {string}
 */
export function buildCsp(env = {}) {
  const { supabaseUrl, isDev, isPreview } = { ...envDefaults(), ...env };
  const supabase = originOf(supabaseUrl);
  const vercelLive = isPreview ? "https://vercel.live" : "";
  const join = (/** @type {string[]} */ parts) => parts.filter(Boolean).join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    join([
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
      isDev ? "'unsafe-eval'" : "",
      "https://www.googletagmanager.com",
      "https://challenges.cloudflare.com",
      "https://cdn.jsdelivr.net https://unpkg.com",
      "https://apis.google.com https://accounts.google.com",
      vercelLive,
    ]),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    join(["media-src 'self' blob:", supabase]),
    join([
      "connect-src 'self'",
      supabase,
      supabase.replace(/^https:/, "wss:"),
      "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
      "https://challenges.cloudflare.com",
      "https://cdn.jsdelivr.net https://unpkg.com",
      "https://www.googleapis.com https://content.googleapis.com",
      vercelLive,
      isDev ? "ws: http://localhost:*" : "",
    ]),
    join([
      "frame-src https://challenges.cloudflare.com https://docs.google.com https://accounts.google.com https://content.googleapis.com",
      vercelLive,
    ]),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    isDev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * @param {HeaderEnv} [env]
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(env = {}) {
  return [
    // Step 1: report-only for one release, then rename to Content-Security-Policy.
    { key: "Content-Security-Policy-Report-Only", value: buildCsp(env) },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // microphone=(self): components/prototyping/dictation.tsx records audio.
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)" },
    // allow-popups keeps Google OAuth / Picker popups and window.open print working.
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  ];
}
