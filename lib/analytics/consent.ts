// Cookie-notice consent state (owner decision D7). Pure: no window, no React,
// so every rule is unit-tested. The component reads/writes the browser storage
// and passes the raw strings in and out of these helpers.
//
// The choice is kept twice, localStorage and a first-party cookie, for 12
// months; either one alone is enough (private modes and cleared site data drop
// one more often than the other). A choice older than 12 months, or anything
// unreadable, counts as "not asked yet".

export type ConsentChoice = "accepted" | "declined";

export const CONSENT_STORAGE_KEY = "gestaltung:cookie-consent";
export const CONSENT_COOKIE = "gestaltung_consent";
/** 12 months, in seconds / milliseconds. */
export const CONSENT_MAX_AGE_S = 365 * 24 * 60 * 60;
export const CONSENT_MAX_AGE_MS = CONSENT_MAX_AGE_S * 1000;

type Stored = { choice: ConsentChoice; at: number };

/** The value written to localStorage and the cookie: `accepted.1790000000000`. */
export function serializeConsent(choice: ConsentChoice, now: number): string {
  return `${choice}.${Math.trunc(now)}`;
}

/** Parse one stored value; null when missing, malformed or older than 12 months. */
export function parseConsent(raw: string | null | undefined, now: number): Stored | null {
  if (!raw) return null;
  const m = /^(accepted|declined)\.(\d{10,})$/.exec(raw.trim());
  if (!m) return null;
  const at = Number(m[2]);
  if (!Number.isFinite(at) || at > now + 60_000) return null; // from the future: clock skew or tampering
  if (now - at >= CONSENT_MAX_AGE_MS) return null; // expired: ask again
  return { choice: m[1] as ConsentChoice, at };
}

/**
 * The visitor's current choice from both stores. If both hold a valid value the
 * newer one wins (they can only differ if one write failed); null = not asked.
 */
export function resolveConsent(
  stored: { local?: string | null; cookie?: string | null },
  now: number
): ConsentChoice | null {
  const a = parseConsent(stored.local, now);
  const b = parseConsent(stored.cookie, now);
  if (a && b) return a.at >= b.at ? a.choice : b.choice;
  return (a ?? b)?.choice ?? null;
}

/** Pull our cookie out of a `document.cookie` string. */
export function readCookie(cookieHeader: string | null | undefined, name = CONSENT_COOKIE): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** The `document.cookie` assignment string: first-party, 12 months, Lax. */
export function consentCookie(choice: ConsentChoice, now: number, secure: boolean): string {
  return [
    `${CONSENT_COOKIE}=${serializeConsent(choice, now)}`,
    `Max-Age=${CONSENT_MAX_AGE_S}`,
    "Path=/",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

/** GA4 may load only after an explicit Accept, and only when an ID is configured. */
export function shouldLoadAnalytics(choice: ConsentChoice | null, gaId: string | null | undefined): boolean {
  return choice === "accepted" && !!gaId && /^G-[A-Z0-9]+$/i.test(gaId);
}

/**
 * Per-property GA4 settings: no Google Signals and no ad personalisation, so
 * the page never makes the `ga-audiences` (advertising audience) request.
 */
export const GA_CONFIG = {
  allow_google_signals: false,
  allow_ad_personalization_signals: false,
} as const;

/**
 * Consent Mode defaults sent BEFORE `config`: analytics storage only, every
 * advertising signal denied.
 */
export const GA_CONSENT_DEFAULT = {
  analytics_storage: "granted",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;

/** gtag.js address for a measurement ID (the only place the URL is built). */
export function gtagSrc(gaId: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
}

/**
 * The ordered commands to push once the user accepted. Returned as data so a
 * test can assert the order (consent default, js, config with signals off).
 */
export function gaCommands(gaId: string, now: Date): unknown[][] {
  return [
    ["consent", "default", GA_CONSENT_DEFAULT],
    ["js", now],
    ["config", gaId, { ...GA_CONFIG }],
  ];
}
