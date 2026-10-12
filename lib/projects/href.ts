// Where a project opens. A PRODUCT project (made with "Plan a product": AI consent in
// the spec, or a saved Studio doc) opens straight in the Studio; anything else
// (drawing requests, CAD-file quote projects, store "add to project" lists) keeps the
// project page. Pure: callers select only the tiny columns it needs, never the docs.

/** Columns to add to a projects select so projectHref works (no big jsonb). */
export const PROJECT_HREF_COLUMNS = "studio_version, ai_consent:spec->aiConsent";

export type ProjectHrefRow = {
  id: string;
  /** projects.studio_version (0068); null/undefined before the migration. */
  studio_version?: number | null;
  /** spec->aiConsent alias (a small object, or null). */
  ai_consent?: unknown;
  /** Full spec, when the caller already has it. */
  spec?: { aiConsent?: unknown } | null;
  /** projects.studio, when the caller already has it. */
  studio?: unknown;
};

export function isStudioProject(row: Omit<ProjectHrefRow, "id">): boolean {
  if (typeof row.studio_version === "number" && row.studio_version > 0) return true;
  const set = (v: unknown) => v !== null && typeof v === "object";
  if (set(row.ai_consent) || set(row.spec?.aiConsent)) return true;
  return row.studio !== null && row.studio !== undefined;
}

/** Locale-less app path (use with the i18n Link/router). */
export function projectHref(row: ProjectHrefRow): string {
  return isStudioProject(row) ? `/projects/${row.id}/studio` : `/projects/${row.id}`;
}

/** /{locale}/projects/<id>/studio with every query parameter of the project page kept (?getItMade=1, ?step=…). */
export function studioRedirectPath(
  locale: string,
  id: string,
  sp: Record<string, string | string[] | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "view") continue;
    if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
    else if (v !== undefined) qs.set(k, v);
  }
  const q = qs.toString();
  return `/${locale}/projects/${id}/studio${q ? `?${q}` : ""}`;
}
