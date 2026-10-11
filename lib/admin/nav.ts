// Dashboard navigation rules (D2, owner 2026-10-11): pure, no React, no I/O.
// The groups themselves live in components/dashboard/admin-nav-groups.ts; the
// sidebar (dashboard-nav.tsx) and the tab bar (dashboard-tabs.tsx) use the
// matching helpers below so a page always lights up exactly one item.

/** Icon names; dashboard-nav.tsx maps them to lucide-react icons. */
export type NavIcon =
  | "home"
  | "orders"
  | "products"
  | "fix"
  | "restock"
  | "discounts"
  | "reviews"
  | "leads"
  | "projects"
  | "credits"
  | "studio"
  | "suppliers"
  | "gaps"
  | "videos"
  | "usage"
  | "notifications"
  | "inventory";

/** "Something to do" counts shown next to a nav item. */
export type BadgeKey = "orders" | "fix" | "leads" | "reviews";
export type NavBadges = Partial<Record<BadgeKey, number>>;

export type NavItem = {
  href: string;
  label: string;
  icon?: NavIcon;
  badge?: BadgeKey;
  /** Other routes that belong to this item (its tabs), so they light it up too. */
  match?: string[];
};
export type NavGroup = { label?: string; items: NavItem[] };

export type NavTab = { href: string; label: string };
/** Routes shown as tabs of one page (each tab is its own route, so deep links keep working). */
export type NavTabSet = { id: string; tabs: NavTab[] };

/** True when `pathname` is `prefix` or below it. "/dashboard" only matches itself. */
export function routeMatches(pathname: string, prefix: string): boolean {
  const p = stripTrailingSlash(pathname);
  if (prefix === "/dashboard") return p === "/dashboard";
  return p === prefix || p.startsWith(`${prefix}/`);
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

/**
 * The item a page belongs to: the item whose href (or one of its `match`
 * routes) is the longest prefix of the path, so /dashboard/store/suppliers
 * lights up Suppliers, not Products. Null when nothing matches.
 */
export function activeItemHref(pathname: string, items: Pick<NavItem, "href" | "match">[]): string | null {
  let best: { href: string; len: number } | null = null;
  for (const item of items) {
    for (const route of [item.href, ...(item.match ?? [])]) {
      if (routeMatches(pathname, route) && (!best || route.length > best.len)) {
        best = { href: item.href, len: route.length };
      }
    }
  }
  return best?.href ?? null;
}

/** The tab set to show on this page: only on a tab's own route (not on edit/new pages below it). */
export function tabSetFor<T extends NavTabSet>(pathname: string, sets: T[]): T | null {
  const p = stripTrailingSlash(pathname);
  return sets.find((s) => s.tabs.some((t) => t.href === p)) ?? null;
}

/** Badge text: nothing at 0 or unknown, "99+" above 99. */
export function badgeText(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

/** "Numbers & funnels" moved into Home: /dashboard/overview sends here. */
export const NUMBERS_ANCHOR = "numbers";
export function overviewRedirectPath(locale: string): string {
  return `/${locale}/dashboard#${NUMBERS_ANCHOR}`;
}
