// Content health — SERVER ONLY (Prompt 11 Step C). The CALLER checks the role
// first (the admin home and /admin/health both require an admin).
//
//   loadContentHealth()          -> every incomplete item, grouped by kind
//   countContentHealthIssues()   -> number | null   (null = could not check; used by the admin home)
//
// Rules are pure (health.ts). This file only reads: the content tables (service
// client), the rubric aspects, and the CC message trees of both locales
// (next-intl getMessages, with admin-edited overrides applied, NOT fs).

import { getMessages } from "next-intl/server";

import { fetchAllRows } from "@/lib/supabase/fetch-all";

import { applyMessageOverrides } from "../content/overrides";
import { loadContentOverrides } from "../content/overrides-server";
import {
  contentIssues,
  ENTITY_SPECS,
  groupIssues,
  messageTodoIssues,
  totalIssues,
  type EntityKind,
  type HealthGroup,
  type HealthIssue,
} from "./health";
import { adminDb, isMissingSchema } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/health-server.ts is server-only");

export type ContentHealth =
  | { ok: true; issues: HealthIssue[]; groups: HealthGroup[]; total: number; checkedAt: string }
  | { ok: false; reason: "unavailable" | "not_set_up" | "error" };

type Db = NonNullable<ReturnType<typeof adminDb>>;
type Row = Record<string, unknown>;

async function readTable(db: Db, table: string, select: string): Promise<{ rows: Row[] | null; missing: boolean }> {
  const { rows, error } = await fetchAllRows<Row>((from, to) => db.from(table).select(select).order("id").range(from, to));
  if (error) {
    const missing = isMissingSchema(error.code);
    if (!missing) console.error(`[cc-health] ${table} read failed:`, error.code ?? error.message);
    return { rows: null, missing };
  }
  return { rows, missing: false };
}

async function messageTrees(): Promise<Partial<Record<"en" | "ar", unknown>>> {
  const out: Partial<Record<"en" | "ar", unknown>> = {};
  for (const locale of ["en", "ar"] as const) {
    try {
      const all = (await getMessages({ locale })) as { CC?: Record<string, unknown> };
      const overrides = await loadContentOverrides(locale);
      out[locale] = applyMessageOverrides(all.CC ?? {}, overrides);
    } catch (e) {
      console.error(`[cc-health] messages (${locale}) failed:`, e instanceof Error ? e.message : "unknown");
    }
  }
  return out;
}

export async function loadContentHealth(): Promise<ContentHealth> {
  const db = adminDb();
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    const reads = await Promise.all(ENTITY_SPECS.map((s) => readTable(db, s.table, s.select)));
    const rows: Partial<Record<EntityKind, Row[]>> = {};
    let anyMissing = false;
    let anyLoaded = false;
    ENTITY_SPECS.forEach((spec, i) => {
      const r = reads[i];
      if (r.rows) {
        rows[spec.kind] = r.rows;
        anyLoaded = true;
      } else if (r.missing) {
        anyMissing = true;
      }
    });
    // The tests table is the base of everything: if it is not there, the CC migrations have not run.
    if (!anyLoaded) return { ok: false, reason: anyMissing ? "not_set_up" : "error" };

    // Which tasks / exercises already have rubric aspects.
    let rubricAspectOwners: { taskIds: Set<string>; exerciseIds: Set<string> } | null = null;
    const { rows: aspectRows, error: aspectError } = await fetchAllRows<{ task_id: string | null; exercise_id: string | null }>((from, to) =>
      db.from("cc_task_aspects").select("id,task_id,exercise_id").like("check_key", "rubric:%").order("id").range(from, to),
    );
    if (!aspectError) {
      rubricAspectOwners = { taskIds: new Set(), exerciseIds: new Set() };
      for (const a of aspectRows) {
        if (a.task_id) rubricAspectOwners.taskIds.add(a.task_id);
        if (a.exercise_id) rubricAspectOwners.exerciseIds.add(a.exercise_id);
      }
    } else if (!isMissingSchema(aspectError.code)) {
      console.error("[cc-health] aspects read failed:", aspectError.code ?? aspectError.message);
    }

    const testSlugById = new Map<string, string>();
    for (const t of rows.test ?? []) {
      if (typeof t.id === "string" && typeof t.slug === "string") testSlugById.set(t.id, t.slug);
    }

    const issues = [
      ...contentIssues({ rows, rubricAspectOwners, links: { testSlugById } }),
      ...messageTodoIssues(await messageTrees()),
    ];
    const groups = groupIssues(issues);
    return { ok: true, issues, groups, total: totalIssues(groups), checkedAt: new Date().toISOString() };
  } catch (e) {
    console.error("[cc-health] load failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Admin home card: number of incomplete items, or null when the check could not run. */
export async function countContentHealthIssues(): Promise<number | null> {
  const health = await loadContentHealth();
  return health.ok ? health.total : null;
}
