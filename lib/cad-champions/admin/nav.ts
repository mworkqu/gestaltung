// CAD Champions admin navigation (Prompt 11). Pure data + role filter, shared
// by the admin shell (side nav) and the page guards. Instructors see only
// Today, Review, Questions and Students; everything else is admin-only.
//
// Each item's `path` is the CC path under /admin (ccPath(locale, path)).
// `labelKey` is a key under CC.admin.nav.

export type AdminNavItem = {
  id: string;
  path: string;
  labelKey: string;
  /** true = instructors see it too. */
  staff?: boolean;
};

export type AdminNavGroup = {
  id: string;
  /** Key under CC.admin.nav.groups, or null for an unlabelled group. */
  labelKey: string | null;
  items: AdminNavItem[];
};

export const ADMIN_NAV: readonly AdminNavGroup[] = [
  {
    id: "work",
    labelKey: null,
    items: [
      { id: "today", path: "/admin", labelKey: "today", staff: true },
      { id: "review", path: "/admin/review", labelKey: "review", staff: true },
      { id: "questions", path: "/admin/questions", labelKey: "questions", staff: true },
      { id: "students", path: "/admin/students", labelKey: "students", staff: true },
    ],
  },
  {
    id: "content",
    labelKey: "content",
    items: [
      { id: "tests", path: "/admin/tests", labelKey: "tests" },
      { id: "exercises", path: "/admin/exercises", labelKey: "exercises" },
      { id: "lessons", path: "/admin/lessons", labelKey: "lessons" },
      { id: "get-ready", path: "/admin/get-ready", labelKey: "getReady" },
      { id: "help", path: "/admin/help", labelKey: "help" },
      { id: "glossary", path: "/admin/glossary", labelKey: "glossary" },
      { id: "landing", path: "/admin/landing", labelKey: "landing" },
      { id: "plans", path: "/admin/plans", labelKey: "plans" },
      { id: "emails", path: "/admin/emails", labelKey: "emails" },
      { id: "health", path: "/admin/health", labelKey: "health" },
    ],
  },
  {
    id: "business",
    labelKey: null,
    items: [
      { id: "payments", path: "/admin/payments", labelKey: "payments" },
      { id: "insights", path: "/admin/insights", labelKey: "insights" },
      { id: "operations", path: "/admin/operations", labelKey: "operations" },
    ],
  },
];

/** The nav as the viewer may see it (empty groups dropped). */
export function navForRole(isAdmin: boolean): AdminNavGroup[] {
  return ADMIN_NAV.map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || i.staff) })).filter((g) => g.items.length > 0);
}

/**
 * The nav item a CC path belongs to (longest matching prefix), e.g.
 * "/admin/tests/abc" -> tests. "/admin" matches only itself.
 */
export function activeNavId(ccRest: string): string | null {
  const path = ccRest.replace(/\/+$/, "") || "/";
  let best: AdminNavItem | null = null;
  for (const g of ADMIN_NAV) {
    for (const i of g.items) {
      const hit = i.path === "/admin" ? path === "/admin" : path === i.path || path.startsWith(`${i.path}/`);
      if (hit && (!best || i.path.length > best.path.length)) best = i;
    }
  }
  return best?.id ?? null;
}

/** May this role open the given admin path? Unknown admin paths are admin-only. */
export function canOpenAdminPath(ccRest: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  const id = activeNavId(ccRest);
  if (!id) return false;
  return ADMIN_NAV.some((g) => g.items.some((i) => i.id === id && i.staff));
}
