"use server";

import { revalidatePath } from "next/cache";

import { planRubricAspectSync, STANDARD_AUTO_TEXTS, standardAutoPoints, validateAspect } from "@/lib/cad-champions/admin/aspects";
import { adminGuard, isMissingSchema, writeAudit, type ActionResult, type AdminDb } from "@/lib/cad-champions/admin/server";
import { answerFilesPrefix, isUuid, moveInList, nextPosition, positionUpdates, renameReferenceParts, sampleFilesPrefix, type TargetKind } from "@/lib/cad-champions/admin/test-builder";
import { CC_LOCALES, type CcCompetitionModuleCode, type CcSkillAreaId } from "@/lib/cad-champions/db/types";
import { parseRubric } from "@/lib/cad-champions/drawing/rubric";
import { callGrader, graderConfigured } from "@/lib/cad-champions/grader/http";
import { isReferenceComplete, type AspectLite, type GraderMode, type StudentGradeResult } from "@/lib/cad-champions/grader/mapping";
import { gradeSubmissionNow } from "@/lib/cad-champions/grader/service";
import { isPathUnderPrefix } from "@/lib/cad-champions/upload/validate";
import { ccPath } from "@/lib/cad-champions/routes";

// Content shared by test tasks and exercises (Prompt 11 Step B): marking
// aspects, reference data from an answer STEP, "Grade a sample" and the
// drawing rubric. `target` says which row: a cc_test_tasks task or a
// cc_exercises exercise (aspects use task_id or exercise_id). Admin only,
// audited, revalidated in both locales.

export type Target = { kind: TargetKind; id: string };

type Fail = { ok: false; error: "not_set_up" | "conflict" | "error" | "invalid" | "not_found" | "unavailable"; detail?: string };

const ANSWER_BUCKET = "cc-answer-files";
const SIGNED_URL_SECONDS = 600;
const DEFAULT_DENSITY = 7850;

function dbError(error: { code?: string; message?: string } | null, label: string): Fail {
  if (error && isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
  if (error?.code === "23505") return { ok: false, error: "conflict" };
  console.error(`[cc-admin-content] ${label} failed:`, error?.code ?? error?.message ?? "unknown");
  return { ok: false, error: "error" };
}

interface TargetRow {
  id: string;
  max_points: number;
  grading_mode: string;
  grader_mode: GraderMode | null;
  reference_data: unknown;
  tolerances: unknown;
  rubric: unknown;
  density_kg_m3: number | null;
  skill_area_id: CcSkillAreaId | null;
  competition_module: CcCompetitionModuleCode | null;
  /** Slug used for revalidation (test slug or exercise slug). */
  slug: string;
}

const TARGET_COLUMNS = "id,max_points,grading_mode,grader_mode,reference_data,tolerances,rubric,density_kg_m3,skill_area_id,competition_module";

async function loadTarget(db: AdminDb, target: Target): Promise<{ ok: true; row: TargetRow } | Fail> {
  if (!target || (target.kind !== "task" && target.kind !== "exercise") || !isUuid(target.id)) return { ok: false, error: "invalid" };
  if (target.kind === "task") {
    const { data, error } = await db
      .from("cc_test_tasks")
      .select(`${TARGET_COLUMNS},test_id`)
      .eq("id", target.id)
      .maybeSingle<Omit<TargetRow, "slug"> & { test_id: string }>();
    if (error) return dbError(error, "target read");
    if (!data) return { ok: false, error: "not_found" };
    const t = await db.from("cc_tests").select("slug").eq("id", data.test_id).maybeSingle<{ slug: string }>();
    return { ok: true, row: { ...data, slug: t.data?.slug ?? "" } };
  }
  const { data, error } = await db.from("cc_exercises").select(`${TARGET_COLUMNS},slug`).eq("id", target.id).maybeSingle<TargetRow>();
  if (error) return dbError(error, "target read");
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, row: data };
}

function revalidateTarget(target: Target, slug: string) {
  for (const l of CC_LOCALES) {
    if (target.kind === "task") {
      revalidatePath(ccPath(l, "/admin/tests"));
      if (slug) {
        revalidatePath(ccPath(l, `/admin/tests/${slug}`));
        revalidatePath(ccPath(l, `/admin/tests/${slug}/preview`));
        revalidatePath(ccPath(l, `/test/${slug}`));
      }
    } else {
      revalidatePath(ccPath(l, "/admin/exercises"));
      if (slug) revalidatePath(ccPath(l, `/admin/exercises/${slug}`));
      revalidatePath(ccPath(l, "/training"), "layout");
    }
  }
}

const parentColumn = (kind: TargetKind) => (kind === "task" ? "task_id" : "exercise_id");
const table = (kind: TargetKind) => (kind === "task" ? "cc_test_tasks" : "cc_exercises");

// ------------------------------------------------------------------ aspects

export async function saveAspectAction(input: { target: Target; aspectId: string | null; fields: Record<string, unknown> }): Promise<ActionResult<{ id: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  const v = validateAspect(input.fields ?? {});
  if (!v.ok) return { ok: false, error: "invalid", detail: v.errors.join(",") };
  const col = parentColumn(input.target.kind);

  if (input.aspectId) {
    if (!isUuid(input.aspectId)) return { ok: false, error: "invalid" };
    const { data: before, error: e1 } = await g.db.from("cc_task_aspects").select("*").eq("id", input.aspectId).eq(col, t.row.id).maybeSingle<Record<string, unknown>>();
    if (e1) return dbError(e1, "aspect read");
    if (!before) return { ok: false, error: "not_found" };
    const { error } = await g.db.from("cc_task_aspects").update(v.value).eq("id", input.aspectId);
    if (error) return dbError(error, "aspect update");
    await writeAudit(g.db, g.cc.user.id, "aspect.update", "cc_task_aspects", input.aspectId, { type: before.type, max_points: before.max_points, method: before.method, check_key: before.check_key }, { type: v.value.type, max_points: v.value.max_points, method: v.value.method, check_key: v.value.check_key });
    revalidateTarget(input.target, t.row.slug);
    return { ok: true, data: { id: input.aspectId } };
  }

  const existing = await g.db.from("cc_task_aspects").select("position").eq(col, t.row.id);
  if (existing.error) return dbError(existing.error, "aspect positions");
  const position = nextPosition((existing.data ?? []) as { position: number }[]);
  const { data, error } = await g.db
    .from("cc_task_aspects")
    .insert({ ...v.value, [col]: t.row.id, position })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return dbError(error, "aspect create");
  await writeAudit(g.db, g.cc.user.id, "aspect.create", "cc_task_aspects", data.id, null, { [col]: t.row.id, type: v.value.type, max_points: v.value.max_points, method: v.value.method });
  revalidateTarget(input.target, t.row.slug);
  return { ok: true, data: { id: data.id } };
}

export async function deleteAspectAction(input: { target: Target; aspectId: string }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  if (!isUuid(input.aspectId)) return { ok: false, error: "invalid" };
  const col = parentColumn(input.target.kind);
  const { data: before, error: e1 } = await g.db.from("cc_task_aspects").select("*").eq("id", input.aspectId).eq(col, t.row.id).maybeSingle<Record<string, unknown>>();
  if (e1) return dbError(e1, "aspect read");
  if (!before) return { ok: false, error: "not_found" };
  const used = await g.db.from("cc_aspect_results").select("id", { count: "exact", head: true }).eq("aspect_id", input.aspectId);
  if ((used.count ?? 0) > 0) return { ok: false, error: "conflict", detail: "has_results" };
  const { error } = await g.db.from("cc_task_aspects").delete().eq("id", input.aspectId);
  if (error) return dbError(error, "aspect delete");
  await writeAudit(g.db, g.cc.user.id, "aspect.delete", "cc_task_aspects", input.aspectId, before, null);
  revalidateTarget(input.target, t.row.slug);
  return { ok: true };
}

export async function moveAspectAction(input: { target: Target; aspectId: string; dir: "up" | "down" }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  if (!isUuid(input.aspectId) || (input.dir !== "up" && input.dir !== "down")) return { ok: false, error: "invalid" };
  const col = parentColumn(input.target.kind);
  const { data, error } = await g.db.from("cc_task_aspects").select("id,position").eq(col, t.row.id).order("position", { ascending: true }).order("created_at", { ascending: true });
  if (error) return dbError(error, "aspect list");
  const rows = (data ?? []) as { id: string; position: number }[];
  const ids = rows.map((r) => r.id);
  if (!ids.includes(input.aspectId)) return { ok: false, error: "not_found" };
  const order = moveInList(ids, input.aspectId, input.dir);
  for (const u of positionUpdates(order, new Map(rows.map((r) => [r.id, r.position])))) {
    const { error: e2 } = await g.db.from("cc_task_aspects").update({ position: u.position }).eq("id", u.id);
    if (e2) return dbError(e2, "aspect reorder");
  }
  await writeAudit(g.db, g.cc.user.id, "aspect.reorder", table(input.target.kind), t.row.id, { order: ids }, { order });
  revalidateTarget(input.target, t.row.slug);
  return { ok: true };
}

/** Adds the four STEP checks (volume, area, inertia, solids) as all-or-nothing measurement aspects. */
export async function addStandardAspectsAction(input: { target: Target }): Promise<ActionResult<{ added: number }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  if (!t.row.skill_area_id) return { ok: false, error: "invalid", detail: "skill_area" };
  if (!(Number(t.row.max_points) > 0)) return { ok: false, error: "invalid", detail: "max_points" };
  const col = parentColumn(input.target.kind);
  const existing = await g.db.from("cc_task_aspects").select("check_key,position").eq(col, t.row.id);
  if (existing.error) return dbError(existing.error, "standard read");
  const rows = (existing.data ?? []) as { check_key: string | null; position: number }[];
  const have = new Set(rows.map((r) => r.check_key));
  let position = nextPosition(rows);
  const inserts = standardAutoPoints(Number(t.row.max_points))
    .filter((p) => !have.has(p.key))
    .map((p) => {
      const d = STANDARD_AUTO_TEXTS[p.key];
      return {
        [col]: t.row.id,
        position: position++,
        description_en: d.en,
        description_ar: d.ar,
        student_hint_en: d.hint_en,
        student_hint_ar: d.hint_ar,
        skill_area_id: t.row.skill_area_id,
        competition_module: t.row.competition_module,
        type: "measurement",
        max_points: p.points,
        method: "auto_step",
        partial_rule: null,
        check_key: p.key,
      };
    });
  if (inserts.length === 0) return { ok: true, data: { added: 0 } };
  const { error } = await g.db.from("cc_task_aspects").insert(inserts);
  if (error) return dbError(error, "standard insert");
  await writeAudit(g.db, g.cc.user.id, "aspect.create_standard", table(input.target.kind), t.row.id, null, { keys: inserts.map((r) => r.check_key) });
  revalidateTarget(input.target, t.row.slug);
  return { ok: true, data: { added: inserts.length } };
}

// ------------------------------------------------------------------ reference data

async function signAnswer(db: AdminDb, path: string): Promise<string | null> {
  const { data, error } = await db.storage.from(ANSWER_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  return error || !data?.signedUrl ? null : data.signedUrl;
}

function graderCode(raw: unknown): string | null {
  const c = raw && typeof raw === "object" ? (raw as { error_code?: unknown }).error_code : null;
  return typeof c === "string" && /^E_[A-Z_]{1,40}$/.test(c) ? c : null;
}

/** Answer STEP -> grader /reference -> the extracted numbers (not saved yet). */
export async function extractReferenceAction(input: { target: Target; path: string }): Promise<ActionResult<{ reference: Record<string, unknown>; warnings: string[] }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  if (!isPathUnderPrefix(input.path, answerFilesPrefix(input.target.kind, t.row.id))) return { ok: false, error: "invalid", detail: "path" };
  if (!graderConfigured()) return { ok: false, error: "unavailable", detail: "grader_not_configured" };
  const url = await signAnswer(g.db, input.path);
  if (!url) return { ok: false, error: "not_found", detail: "file_missing" };
  const density = Number(t.row.density_kg_m3) > 0 ? Number(t.row.density_kg_m3) : DEFAULT_DENSITY;
  const res = await callGrader("/reference", { file_url: url, density_kg_m3: density });
  if (!res.ok) {
    const code = graderCode(res.raw);
    console.error("[cc-admin-content] /reference failed:", res.kind, res.error);
    return { ok: false, error: "error", detail: code ?? (res.kind === "not_configured" ? "grader_not_configured" : "grader_failed") };
  }
  await writeAudit(g.db, g.cc.user.id, "reference.extract", table(input.target.kind), t.row.id, null, { file: input.path.split("/").pop(), volume_mm3: res.data.reference_data.volume_mm3 ?? null });
  return { ok: true, data: { reference: res.data.reference_data, warnings: res.data.warnings.filter((w) => /^[A-Z0-9_]{1,40}$/.test(w)) } };
}

/** Saves reference_data (assemblies: with the admin's part names). */
export async function saveReferenceAction(input: { target: Target; reference: Record<string, unknown>; partNames: string[] }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  if (!input.reference || typeof input.reference !== "object" || JSON.stringify(input.reference).length > 200_000) return { ok: false, error: "invalid" };
  const renamed = renameReferenceParts(input.reference, Array.isArray(input.partNames) ? input.partNames.map(String) : []);
  if (!renamed) return { ok: false, error: "invalid", detail: "part_names" };
  if (!isReferenceComplete(renamed)) return { ok: false, error: "invalid", detail: "incomplete" };
  const { error } = await g.db.from(table(input.target.kind)).update({ reference_data: renamed }).eq("id", t.row.id);
  if (error) return dbError(error, "reference save");
  const summary = (r: unknown) => (r && typeof r === "object" ? { volume_mm3: (r as Record<string, unknown>).volume_mm3 ?? null, solids: (r as Record<string, unknown>).solids ?? null } : null);
  await writeAudit(g.db, g.cc.user.id, "reference.save", table(input.target.kind), t.row.id, summary(t.row.reference_data), summary(renamed));
  revalidateTarget(input.target, t.row.slug);
  return { ok: true };
}

// ------------------------------------------------------------------ grade a sample

export interface SampleAspect {
  id: string;
  description_en: string;
  description_ar: string;
  passed: boolean;
  points: number;
  maxPoints: number;
}

/** Grades any STEP with this task's reference + tolerances. Nothing is written; the sample file is removed afterwards. */
export async function gradeSampleAction(input: { target: Target; path: string }): Promise<ActionResult<{ result: StudentGradeResult; aspects: SampleAspect[]; mode: GraderMode }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  if (!isPathUnderPrefix(input.path, sampleFilesPrefix(input.target.kind, t.row.id))) return { ok: false, error: "invalid", detail: "path" };
  const col = parentColumn(input.target.kind);
  const a = await g.db.from("cc_task_aspects").select("id,check_key,max_points,method,description_en,description_ar").eq(col, t.row.id).order("position", { ascending: true });
  if (a.error) return dbError(a.error, "sample aspects");
  const aspectRows = (a.data ?? []) as (AspectLite & { description_en: string; description_ar: string })[];
  const mode: GraderMode = t.row.grader_mode ?? (input.target.kind === "exercise" ? "practice" : "part");
  try {
    const out = await gradeSubmissionNow({
      mode,
      file: { bucket: ANSWER_BUCKET, path: input.path },
      logId: `admin-sample-${t.row.id}`,
      task: {
        id: t.row.id,
        max_points: Number(t.row.max_points) || 0,
        reference_data: t.row.reference_data,
        tolerances: t.row.tolerances,
        density_kg_m3: t.row.density_kg_m3,
        aspects: aspectRows.map((r) => ({ id: r.id, check_key: r.check_key, max_points: Number(r.max_points), method: r.method })),
      },
    });
    if (!out.ok) {
      console.error("[cc-admin-content] sample grade failed:", out.reason, out.error);
      return { ok: false, error: out.reason === "not_configured" ? "unavailable" : "error", detail: out.reason };
    }
    const byId = new Map(aspectRows.map((r) => [r.id, r]));
    return {
      ok: true,
      data: {
        mode,
        result: out.result,
        aspects: out.aspects.map((o) => ({
          id: o.aspectId,
          description_en: byId.get(o.aspectId)?.description_en ?? "",
          description_ar: byId.get(o.aspectId)?.description_ar ?? "",
          passed: o.passed,
          points: o.points,
          maxPoints: o.maxPoints,
        })),
      },
    };
  } finally {
    const { error } = await g.db.storage.from(ANSWER_BUCKET).remove([input.path]);
    if (error) console.error("[cc-admin-content] sample cleanup failed:", error.message);
  }
}

// ------------------------------------------------------------------ rubric

/** Saves the drawing rubric, then syncs its `rubric:<id>` aspects (SQL for tasks, the same rule in TypeScript for exercises). */
export async function saveRubricAction(input: { target: Target; rubric: unknown }): Promise<ActionResult<{ items: number }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const t = await loadTarget(g.db, input?.target);
  if (!t.ok) return t;
  const raw = input.rubric as { items?: unknown[] } | null;
  const parsed = parseRubric(raw);
  if (!parsed || !Array.isArray(raw?.items) || parsed.items.length !== raw.items.length) return { ok: false, error: "invalid", detail: "items" };
  if (parsed.items.some((i) => !i.text_en.trim() || !i.text_ar.trim() || i.text_en === i.id)) return { ok: false, error: "invalid", detail: "texts" };
  const value = parsed.items.length > 0 ? parsed : null;
  if (input.target.kind === "exercise" && value && !t.row.skill_area_id) return { ok: false, error: "invalid", detail: "skill_area" };

  const { error } = await g.db.from(table(input.target.kind)).update({ rubric: value }).eq("id", t.row.id);
  if (error) return dbError(error, "rubric save");

  if (input.target.kind === "task") {
    const { error: e2 } = await g.db.rpc("cc_sync_rubric_aspects", { p_task: t.row.id });
    if (e2) {
      if (isMissingSchema(e2.code)) return { ok: false, error: "not_set_up", detail: "sync" };
      return dbError(e2, "rubric sync");
    }
    if (!value) {
      // The SQL function returns early on an empty rubric: remove its aspects here.
      const { error: e3 } = await g.db.from("cc_task_aspects").delete().eq("task_id", t.row.id).like("check_key", "rubric:%");
      if (e3) return dbError(e3, "rubric clear");
    }
  } else {
    const ex = await g.db.from("cc_task_aspects").select("id,check_key").eq("exercise_id", t.row.id);
    if (ex.error) return dbError(ex.error, "rubric aspects read");
    const plan = planRubricAspectSync(value, (ex.data ?? []) as { id: string; check_key: string | null }[], {
      skill_area_id: (t.row.skill_area_id ?? 1) as CcSkillAreaId,
      competition_module: t.row.competition_module,
    });
    for (const u of plan.updates) {
      const { error: e } = await g.db.from("cc_task_aspects").update(u.row).eq("id", u.id);
      if (e) return dbError(e, "rubric aspect update");
    }
    if (plan.inserts.length > 0) {
      const { error: e } = await g.db.from("cc_task_aspects").insert(plan.inserts.map((r) => ({ ...r, exercise_id: t.row.id })));
      if (e) return dbError(e, "rubric aspect insert");
    }
    if (plan.deleteIds.length > 0) {
      const { error: e } = await g.db.from("cc_task_aspects").delete().in("id", plan.deleteIds);
      if (e) return dbError(e, "rubric aspect delete");
    }
  }
  const before = parseRubric(t.row.rubric);
  await writeAudit(g.db, g.cc.user.id, "rubric.save", table(input.target.kind), t.row.id, before ? { items: before.items.map((i) => i.id) } : null, value ? { items: value.items.map((i) => i.id), kind: value.kind } : null);
  revalidateTarget(input.target, t.row.slug);
  return { ok: true, data: { items: value?.items.length ?? 0 } };
}
