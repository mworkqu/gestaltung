"use server";

import { revalidatePath } from "next/cache";

import { exercisePublishChecks } from "@/lib/cad-champions/admin/publish-check";
import { adminGuard, isMissingSchema, writeAudit, type ActionResult } from "@/lib/cad-champions/admin/server";
import { isUuid, parseExerciseInput } from "@/lib/cad-champions/admin/test-builder";
import { CC_LOCALES, type CcExercise } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Exercise builder actions (Prompt 11 Step B). Admin only (adminGuard on
// every call), validated, audited; revalidates the admin pages and the
// training pages in both locales. Aspects, reference data, "Grade a sample"
// and the rubric use the shared actions in ../tests/content-actions.ts.

type Fail = { ok: false; error: "not_set_up" | "conflict" | "error" | "invalid" | "not_found"; detail?: string };

function dbError(error: { code?: string; message?: string } | null, label: string): Fail {
  if (error && isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
  if (error?.code === "23505") return { ok: false, error: "conflict", detail: "slug" };
  if (error?.code === "23503") return { ok: false, error: "invalid", detail: "level_id" };
  console.error(`[cc-admin-exercises] ${label} failed:`, error?.code ?? error?.message ?? "unknown");
  return { ok: false, error: "error" };
}

function revalidateExercise(slugs: (string | null | undefined)[]) {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/exercises"));
    for (const s of slugs) if (s) revalidatePath(ccPath(l, `/admin/exercises/${s}`));
    revalidatePath(ccPath(l, "/training"), "layout");
  }
}

export async function createExerciseAction(raw: Record<string, unknown>): Promise<ActionResult<{ slug: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const v = parseExerciseInput(raw ?? {});
  if (!v.ok) return { ok: false, error: "invalid", detail: v.errors.join(",") };
  const { data, error } = await g.db.from("cc_exercises").insert({ ...v.value, is_published: false }).select("id,slug").single<{ id: string; slug: string }>();
  if (error || !data) return dbError(error, "create");
  await writeAudit(g.db, g.cc.user.id, "exercise.create", "cc_exercises", data.id, null, { slug: data.slug, level_id: v.value.level_id, title_en: v.value.title_en });
  revalidateExercise([data.slug]);
  return { ok: true, data: { slug: data.slug } };
}

export async function updateExerciseAction(id: string, raw: Record<string, unknown>): Promise<ActionResult<{ slug: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  const v = parseExerciseInput(raw ?? {});
  if (!v.ok) return { ok: false, error: "invalid", detail: v.errors.join(",") };
  const { data: before, error: e1 } = await g.db.from("cc_exercises").select("*").eq("id", id).maybeSingle<CcExercise>();
  if (e1) return dbError(e1, "read");
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_exercises").update(v.value).eq("id", id);
  if (error) return dbError(error, "update");
  const keys = Object.keys(v.value) as (keyof typeof v.value)[];
  const changed = keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(v.value[k] ?? null));
  if (changed.length > 0) {
    await writeAudit(
      g.db,
      g.cc.user.id,
      "exercise.update",
      "cc_exercises",
      id,
      Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      Object.fromEntries(changed.map((k) => [k, v.value[k] ?? null])),
    );
  }
  revalidateExercise([before.slug, v.value.slug]);
  return { ok: true, data: { slug: v.value.slug } };
}

export async function setExercisePublishedAction(input: { id: string; publish: boolean }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!isUuid(input?.id) || typeof input.publish !== "boolean") return { ok: false, error: "invalid" };
  const { data: ex, error: e1 } = await g.db.from("cc_exercises").select("*").eq("id", input.id).maybeSingle<CcExercise>();
  if (e1) return dbError(e1, "publish read");
  if (!ex) return { ok: false, error: "not_found" };
  if (ex.is_published === input.publish) return { ok: true };
  if (input.publish) {
    const a = await g.db.from("cc_task_aspects").select("type,max_points").eq("exercise_id", ex.id);
    if (a.error) return dbError(a.error, "publish aspects");
    const checks = exercisePublishChecks({ exercise: ex, aspects: (a.data ?? []) as { type: string; max_points: number }[] });
    if (!checks.canPublish) return { ok: false, error: "invalid", detail: "blocked" };
  }
  const { error } = await g.db.from("cc_exercises").update({ is_published: input.publish }).eq("id", ex.id);
  if (error) return dbError(error, "publish");
  await writeAudit(g.db, g.cc.user.id, input.publish ? "exercise.publish" : "exercise.unpublish", "cc_exercises", ex.id, { is_published: ex.is_published }, { is_published: input.publish, slug: ex.slug });
  revalidateExercise([ex.slug]);
  return { ok: true };
}
