// Where the product edit form goes after Save / Cancel (D1). The list the
// owner came from (Fix list, catalog, restock, stock) passes its own URL, with
// filters and a #row anchor, as ?returnTo=. It comes back through a hidden
// form field, so it is attacker-controllable: only a same-origin path inside
// this locale's dashboard is accepted. Anything else → the catalog. Pure.

const CONTROL = /[\u0000-\u001f\u007f\\]/;

/** A safe /{locale}/dashboard/... path, or null. */
export function safeReturnTo(raw: unknown, locale: string): string | null {
  if (typeof raw !== "string") return null;
  if (CONTROL.test(raw)) return null;
  const value = raw.trim();
  if (!value || value.length > 2000) return null;
  // No scheme, no protocol-relative //host, nothing that leaves the site.
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("//")) return null;
  const prefix = `/${locale}/dashboard/`;
  if (!value.startsWith(prefix)) return null;
  let url: URL;
  try {
    url = new URL(value, "https://same.origin");
  } catch {
    return null;
  }
  if (url.origin !== "https://same.origin") return null;
  // Normalised (e.g. /en/dashboard/../admin) must still be in the dashboard.
  if (!url.pathname.startsWith(prefix)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Where to go after saving: the safe returnTo, else the catalog. */
export function returnToOrCatalog(raw: unknown, locale: string): string {
  return safeReturnTo(raw, locale) ?? `/${locale}/dashboard/store`;
}

/** Edit link (no locale prefix, for the i18n Link) carrying ?returnTo=. */
export function editHref(partId: string, returnTo?: string | null): string {
  const base = `/dashboard/store/${partId}/edit`;
  return returnTo ? `${base}?returnTo=${encodeURIComponent(returnTo)}` : base;
}

/** Current list URL (with locale) plus a row anchor, for returnTo. */
export function listUrl(locale: string, path: string, query: Record<string, string | undefined>, anchor?: string): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) qs.set(k, v);
  const q = qs.toString();
  return `/${locale}${path}${q ? `?${q}` : ""}${anchor ? `#${anchor}` : ""}`;
}
