// Project link by email (owner decision D6, migration 0045). Pure helpers:
// the link format and reading the key back from the URL fragment. The email
// itself is in link-email.ts (server side). Safe to import in the browser.
//
// The key travels in the URL FRAGMENT (#key=…), never the query string: a
// fragment is not sent to any server, not put in Referer headers and not part
// of analytics page_location.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** `https://site/{locale}/projects/{id}#key={token}` */
export function projectLinkUrl(siteUrl: string, locale: "en" | "ar", projectId: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, "")}/${locale}/projects/${projectId}#key=${token}`;
}

/** The key from a location.hash like "#key=<uuid>"; null when absent or malformed. */
export function recoveryKeyFromHash(hash: string | null | undefined): string | null {
  const raw = (hash ?? "").replace(/^#/, "");
  if (!raw) return null;
  const key = new URLSearchParams(raw).get("key");
  return isUuid(key) ? key.toLowerCase() : null;
}

/**
 * The site the emailed link points at: NEXT_PUBLIC_SITE_URL, else the live
 * domain in production — never the request's Host header, since the link goes
 * into an email. In development the request origin (localhost) is used.
 */
export function siteUrlFor(requestUrl: string): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.NODE_ENV === "production") return "https://gestaltung360.com";
  return new URL(requestUrl).origin;
}
