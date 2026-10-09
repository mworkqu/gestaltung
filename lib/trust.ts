// "Trusted by" logos (P1-04): store_settings.key = 'trusted_by', a jsonb array
// of { name, logo_url, href? }. The owner fills it by hand once there are
// customers who agreed to be shown; the key is NOT seeded, and while it is
// missing or empty the whole row is hidden (no heading, no placeholder).
//
// The value is public (store_settings is anon-readable), but it is still
// parsed defensively: only https:// (or site-relative) logo URLs, only https://
// links, a name for every entry, at most 12 entries.

export type TrustedLogo = { name: string; logo_url: string; href?: string };

export const TRUSTED_BY_KEY = "trusted_by";
export const TRUSTED_BY_MAX = 12;

const isHttps = (s: string): boolean => {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
};

/** A logo may be an https:// URL or a path on this site ("/logos/x.svg"), never "//host" or "javascript:". */
const isLogoUrl = (s: string): boolean => (s.startsWith("/") && !s.startsWith("//")) || isHttps(s);

/** Any stored shape → the valid logo entries (empty array when there is nothing to show). */
export function parseTrustedBy(value: unknown): TrustedLogo[] {
  if (!Array.isArray(value)) return [];
  const out: TrustedLogo[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 80) : "";
    const logo = typeof r.logo_url === "string" ? r.logo_url.trim() : "";
    if (!name || !logo || !isLogoUrl(logo)) continue;
    const href = typeof r.href === "string" ? r.href.trim() : "";
    out.push(href && isHttps(href) ? { name, logo_url: logo, href } : { name, logo_url: logo });
    if (out.length >= TRUSTED_BY_MAX) break;
  }
  return out;
}
