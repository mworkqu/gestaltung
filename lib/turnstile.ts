// Cloudflare Turnstile (P2-08) — pure helpers, safe on server and client.
//
// Behind a switch that is OFF by default: store_settings.turnstile =
// {"enabled": false} (migration 0055). Two env vars:
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY  public, renders the widget
//   TURNSTILE_SECRET_KEY            server only, verifies a token
// The widget renders only when the switch is on AND the site key is set
// (turnstileWidgetOn). Our own routes verify only when the switch is on AND
// both keys are set (turnstileRequired) — never demand a token that no widget
// on the page could produce. With the switch off nothing changes.
//
// Supabase Auth verifies its own tokens (Dashboard → Authentication → Attack
// Protection → CAPTCHA, with the same secret); this file is not involved there.

export const TURNSTILE_KEY = "turnstile";
/** The form field Cloudflare's own widget would use; our widget mirrors it. */
export const TURNSTILE_FIELD = "cf-turnstile-response";
/** Header carrying a token on JSON / streaming routes (/api/analyse). */
export const TURNSTILE_HEADER = "x-turnstile-token";
export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Cloudflare caps a token at 2048 characters. */
const MAX_TOKEN = 2048;

export type TurnstileSettings = { enabled: boolean };
export const TURNSTILE_DEFAULTS: TurnstileSettings = { enabled: false };

/** Anything but an explicit `enabled: true` is OFF. */
export function parseTurnstileSettings(raw: unknown): TurnstileSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { enabled: o.enabled === true };
}

type Env = { siteKey?: string | null; secret?: string | null };

/** The keys from process.env (read at call time, so tests can swap them). */
export function turnstileEnv(): Env {
  return {
    siteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
    secret: process.env.TURNSTILE_SECRET_KEY ?? null,
  };
}

/** Should the widget render? Switch on and a site key. */
export function turnstileWidgetOn(settings: TurnstileSettings | null | undefined, siteKey: string | null | undefined): boolean {
  return !!settings?.enabled && !!siteKey?.trim();
}

/** Must our server verify a token? Switch on, a secret, and a site key (else no widget could have produced one). */
export function turnstileRequired(settings: TurnstileSettings | null | undefined, env: Env): boolean {
  return turnstileWidgetOn(settings, env.siteKey) && !!env.secret?.trim();
}

function cleanToken(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s && s.length <= MAX_TOKEN ? s : null;
}

/**
 * The token from a request: FormData (the hidden field), Headers (the
 * x-turnstile-token header) or a parsed JSON body ({ turnstileToken } or the
 * field name). Null when absent, empty or over Cloudflare's length cap.
 */
export function readTurnstileToken(src: FormData | Headers | Record<string, unknown> | null | undefined): string | null {
  if (!src) return null;
  if (typeof Headers !== "undefined" && src instanceof Headers) return cleanToken(src.get(TURNSTILE_HEADER));
  if (typeof FormData !== "undefined" && src instanceof FormData) return cleanToken(src.get(TURNSTILE_FIELD));
  const o = src as Record<string, unknown>;
  return cleanToken(o.turnstileToken) ?? cleanToken(o[TURNSTILE_FIELD]);
}

/** The caller's IP: the first x-forwarded-for hop (Vercel sets it), else x-real-ip. */
export function clientIp(headers: Headers): string | null {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "";
  return ip || null;
}

export type VerifyResult = { ok: boolean; codes: string[] };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/**
 * Cloudflare siteverify. Never throws: a network error, a timeout or a non-2xx
 * answer is a failed check (fail closed — this only runs while the switch is
 * on). `fetchImpl` is injectable for tests.
 */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null | undefined,
  opts: { secret: string; fetchImpl?: FetchLike; timeoutMs?: number },
): Promise<VerifyResult> {
  const t = cleanToken(token);
  if (!t) return { ok: false, codes: ["missing-input-response"] };
  if (!opts.secret) return { ok: false, codes: ["missing-input-secret"] };
  const body = new URLSearchParams({ secret: opts.secret, response: t });
  if (ip) body.set("remoteip", ip);
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  try {
    const res = await doFetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(opts.timeoutMs ?? 8000) : undefined,
    });
    if (!res.ok) return { ok: false, codes: ["http-error"] };
    const data = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
    const codes = Array.isArray(data["error-codes"]) ? data["error-codes"].map(String) : [];
    return { ok: data.success === true, codes };
  } catch {
    return { ok: false, codes: ["network-error"] };
  }
}
