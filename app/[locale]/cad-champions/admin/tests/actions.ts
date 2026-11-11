"use server";

import { revalidatePath } from "next/cache";

import { buildExpectationsJson, type ExpectationsDraft } from "@/lib/cad-champions/admin/package-expectations";
import { publishChecks, type PublishIssue } from "@/lib/cad-champions/admin/publish-check";
import { adminGuard, isMissingSchema, writeAudit, type ActionResult, type AdminDb } from "@/lib/cad-champions/admin/server";
import { isUuid, moveInList, nextPosition, parseTaskInput, parseTestCreate, parseTestSettings, positionUpdates } from "@/lib/cad-champions/admin/test-builder";
import { CC_LOCALES, type CcTaskAspect, type CcTest, type CcTestTask } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Test builder actions (Prompt 11 Step B). Admin only: adminGuard("admin")
// on every call, validation, audit log, then revalidation of the admin pages
// and the student test pages in both locales.

type Fail = { ok: false; error: "not_set_up" | "conflict" | "error" | "invalid" | "not_found"; detail?: string };

function dbError(error: { code?: string; message?: string } | null, label: string): Fail {
  if (error && isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
  if (error?.code === "23505") return { ok: false, error: "conflict" };
  console.error(`[cc-admin-tests] ${label} failed:`, error?.code ?? error?.message ?? "unknown");
  return { ok: false, error: "error" };
}

function revalidateTest(slug: string | null) {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/tests"));
    revalidatePath(ccPath(l, "/test"));
    if (slug) {
      revalidatePath(ccPath(l, `/admin/tests/${slug}`));
      revalidatePath(ccPath(l, `/admin/tests/${slug}/preview`));
      revalidatePath(ccPath(l, `/test/${slug}`));
    }
  }
}

async function readTest(db: AdminDb, testId: string) {
  return db.from("cc_tests").select("*").eq("id", testId).maybeSingle<CcTest>();
}

// ------------------------------------------------------------------ tests

export async function createTestAction(raw: Record<string, unknown>): Promise<ActionResult<{ slug: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const v = parseTestCreate(raw ?? {});
  if (!v.ok) return { ok: false, error: "invalid", detail: v.errors.join(",") };
  const { data, error } = await g.db
    .from("cc_tests")
    .insert({ ...v.value, created_by: g.cc.user.id, package_expectations: {} })
    .select("id,slug")
    .single<{ id: string; slug: string }>();
  if (error || !data) return dbError(error, "create");
  await writeAudit(g.db, g.cc.user.id, "test.create", "cc_tests", data.id, null, v.value);
  revalidateTest(data.slug);
  return { ok: true, data: { slug: data.slug } };
}

export async function updateTestAction(testId: string, raw: Record<string, unknown>): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(testId)) return { ok: false, error: "not_found" };
  const v = parseTestSettings(raw ?? {});
  if (!v.ok) return { ok: false, error: "invalid", detail: v.errors.join(",") };
  const { data: before, error: e1 } = await readTest(g.db, testId);
  if (e1) return dbError(e1, "read");
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_tests").update(v.value).eq("id", testId);
  if (error) return dbError(error, "update");
  const changed = Object.fromEntries(Object.entries(v.value).filter(([k, val]) => (before as unknown as Record<string, unknown>)[k] !== val));
  if (Object.keys(changed).length > 0) {
    const prev = Object.fromEntries(Object.keys(changed).map((k) => [k, (before as unknown as Record<string, unknown>)[k] ?? null]));
    await writeAudit(g.db, g.cc.user.id, "test.update", "cc_tests", testId, prev, changed);
  }
  revalidateTest(before.slug);
  return { ok: true };
}

export async function setTestPublishedAction(input: { testId: string; publish: boolean }): Promise<ActionResult<{ blocking: PublishIssue[] }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(input?.testId) || typeof input.publish !== "boolean") return { ok: false, error: "invalid" };
  const { data: test, error: e1 } = await readTest(g.db, input.testId);
  if (e1) return dbError(e1, "publish read");
  if (!test) return { ok: false, error: "not_found" };
  if (test.is_published === input.publish) return { ok: true, data: { blocking: [] } };
  if (input.publish) {
    const t = await g.db.from("cc_test_tasks").select("*").eq("test_id", test.id);
    if (t.error) return dbError(t.error, "publish tasks");
    const tasks = (t.data ?? []) as CcTestTask[];
    const a = tasks.length ? await g.db.from("cc_task_aspects").select("task_id,type,max_points").in("task_id", tasks.map((x) => x.id)) : { data: [], error: null };
    if (a.error) return dbError(a.error, "publish aspects");
    const checks = publishChecks({ test, tasks, aspects: (a.data ?? []) as Pick<CcTaskAspect, "task_id" | "type" | "max_points">[] });
    if (!checks.canPublish) return { ok: false, error: "invalid", detail: "blocked" };
  }
  const { error } = await g.db.from("cc_tests").update({ is_published: input.publish }).eq("id", test.id);
  if (error) return dbError(error, "publish");
  await writeAudit(g.db, g.cc.user.id, input.publish ? "test.publish" : "test.unpublish", "cc_tests", test.id, { is_published: test.is_published }, { is_published: input.publish, slug: test.slug });
  revalidateTest(test.slug);
  return { ok: true, data: { blocking: [] } };
}

export async function savePackageExpectationsAction(input: { testId: string; draft: ExpectationsDraft }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(input?.testId) || !input.draft) return { ok: false, error: "invalid" };
  const { data: test, error: e1 } = await readTest(g.db, input.testId);
  if (e1) return dbError(e1, "expectations read");
  if (!test) return { ok: false, error: "not_found" };
  const t = await g.db.from("cc_test_tasks").select("id").eq("test_id", test.id);
  if (t.error) return dbError(t.error, "expectations tasks");
  const built = buildExpectationsJson(input.draft, ((t.data ?? []) as { id: string }[]).map((x) => x.id));
  if (!built.ok) return { ok: false, error: "invalid", detail: built.issues.map((i) => i.error).join(",") };
  const { error } = await g.db.from("cc_tests").update({ package_expectations: built.json }).eq("id", test.id);
  if (error) return dbError(error, "expectations save");
  await writeAudit(g.db, g.cc.user.id, "test.package_expectations", "cc_tests", test.id, test.package_expectations ?? null, built.json);
  revalidateTest(test.slug);
  return { ok: true };
}

// ------------------------------------------------------------------ tasks

export async function saveTaskAction(input: { testId: string; taskId: string | null; fields: Record<string, unknown> }): Promise<ActionResult<{ id: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(input?.testId) || (input.taskId != null && !isUuid(input.taskId))) return { ok: false, error: "invalid" };
  const v = parseTaskInput(input.fields ?? {});
  if (!v.ok) return { ok: false, error: "invalid", detail: v.errors.join(",") };
  const { data: test, error: e1 } = await readTest(g.db, input.testId);
  if (e1) return dbError(e1, "task read test");
  if (!test) return { ok: false, error: "not_found" };

  if (input.taskId) {
    const { data: before, error: e2 } = await g.db.from("cc_test_tasks").select("*").eq("id", input.taskId).eq("test_id", test.id).maybeSingle<CcTestTask>();
    if (e2) return dbError(e2, "task read");
    if (!before) return { ok: false, error: "not_found" };
    const { error } = await g.db.from("cc_test_tasks").update(v.value).eq("id", before.id);
    if (error) return dbError(error, "task update");
    const keys = Object.keys(v.value) as (keyof typeof v.value)[];
    const changed = keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(v.value[k] ?? null));
    if (changed.length > 0) {
      await writeAudit(
        g.db,
        g.cc.user.id,
        "task.update",
        "cc_test_tasks",
        before.id,
        Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
        Object.fromEntries(changed.map((k) => [k, v.value[k] ?? null])),
      );
    }
    revalidateTest(test.slug);
    return { ok: true, data: { id: before.id } };
  }

  const existing = await g.db.from("cc_test_tasks").select("position").eq("test_id", test.id);
  if (existing.error) return dbError(existing.error, "task positions");
  const position = nextPosition((existing.data ?? []) as { position: number }[]);
  const { data, error } = await g.db
    .from("cc_test_tasks")
    .insert({ ...v.value, test_id: test.id, position })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return dbError(error, "task create");
  await writeAudit(g.db, g.cc.user.id, "task.create", "cc_test_tasks", data.id, null, { test: test.slug, position, title_en: v.value.title_en });
  revalidateTest(test.slug);
  return { ok: true, data: { id: data.id } };
}

async function renumber(db: AdminDb, testId: string, order?: string[]) {
  const { data } = await db.from("cc_test_tasks").select("id,position").eq("test_id", testId).order("position", { ascending: true });
  const rows = (data ?? []) as { id: string; position: number }[];
  const ids = order ?? rows.map((r) => r.id);
  const updates = positionUpdates(ids, new Map(rows.map((r) => [r.id, r.position])));
  for (const u of updates) {
    const { error } = await db.from("cc_test_tasks").update({ position: u.position }).eq("id", u.id);
    if (error) return error;
  }
  return null;
}

export async function moveTaskAction(input: { testId: string; taskId: string; dir: "up" | "down" }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(input?.testId) || !isUuid(input.taskId) || (input.dir !== "up" && input.dir !== "down")) return { ok: false, error: "invalid" };
  const { data: test, error: e1 } = await readTest(g.db, input.testId);
  if (e1) return dbError(e1, "move read");
  if (!test) return { ok: false, error: "not_found" };
  const { data, error } = await g.db.from("cc_test_tasks").select("id,position").eq("test_id", test.id).order("position", { ascending: true });
  if (error) return dbError(error, "move list");
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.includes(input.taskId)) return { ok: false, error: "not_found" };
  const order = moveInList(ids, input.taskId, input.dir);
  const e2 = await renumber(g.db, test.id, order);
  if (e2) return dbError(e2, "move save");
  await writeAudit(g.db, g.cc.user.id, "task.reorder", "cc_tests", test.id, { order: ids }, { order });
  revalidateTest(test.slug);
  return { ok: true };
}

export async function deleteTaskAction(input: { testId: string; taskId: string }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(input?.testId) || !isUuid(input.taskId)) return { ok: false, error: "invalid" };
  const { data: test, error: e1 } = await readTest(g.db, input.testId);
  if (e1) return dbError(e1, "delete read test");
  if (!test) return { ok: false, error: "not_found" };
  const { data: before, error: e2 } = await g.db.from("cc_test_tasks").select("*").eq("id", input.taskId).eq("test_id", test.id).maybeSingle<CcTestTask>();
  if (e2) return dbError(e2, "delete read");
  if (!before) return { ok: false, error: "not_found" };
  // Never delete a task students already answered (their results would go with it).
  const [subs, results] = await Promise.all([
    g.db.from("cc_submissions").select("id", { count: "exact", head: true }).eq("task_id", before.id),
    g.db.from("cc_task_results").select("id", { count: "exact", head: true }).eq("task_id", before.id),
  ]);
  if ((subs.count ?? 0) > 0 || (results.count ?? 0) > 0) return { ok: false, error: "conflict", detail: "has_results" };
  const { error } = await g.db.from("cc_test_tasks").delete().eq("id", before.id);
  if (error) return dbError(error, "delete");
  await renumber(g.db, test.id);
  await writeAudit(g.db, g.cc.user.id, "task.delete", "cc_test_tasks", before.id, before, null);
  revalidateTest(test.slug);
  return { ok: true };
}
