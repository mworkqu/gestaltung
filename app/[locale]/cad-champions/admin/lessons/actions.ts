"use server";

import { revalidatePath } from "next/cache";

import { adminGuard, isMissingSchema, writeAudit, type ActionResult, type AdminDb } from "@/lib/cad-champions/admin/server";
import {
  buildTrackNotes,
  computeReorder,
  freePreviewAuditAction,
  isSlug,
  nextSort,
  publishAuditAction,
  str,
  validateLessonInput,
  validateLevelInput,
  validateModuleInput,
  type FieldErrors,
} from "@/lib/cad-champions/admin/lessons";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Training content admin actions (Prompt 11). Admin only: every call runs
// adminGuard("admin") first, validates its input, audits publish / free
// preview / create / delete, and revalidates the admin and student pages in
// both locales. Lesson notes / videos / downloads are column-restricted for
// students since 0083, so everything here uses the service client.

type Raw = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(errors: FieldErrors): { ok: false; error: "invalid"; detail: string } {
  return { ok: false, error: "invalid", detail: Object.keys(errors).join(",") };
}

function dbError(error: { code?: string; message?: string }, label: string): { ok: false; error: "not_set_up" | "conflict" | "error" } {
  if (isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
  if (error.code === "23505") return { ok: false, error: "conflict" };
  console.error(`[cc-admin-lessons] ${label} failed:`, error.code ?? error.message ?? "unknown");
  return { ok: false, error: "error" };
}

function revalidate(opts: { moduleSlug?: string | null; lessonSlugs?: (string | null | undefined)[] }) {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/lessons"));
    revalidatePath(ccPath(l, "/training"));
    if (opts.moduleSlug) revalidatePath(ccPath(l, `/training/${opts.moduleSlug}`));
    for (const s of opts.lessonSlugs ?? []) if (s) revalidatePath(ccPath(l, `/training/lessons/${s}`));
  }
}

async function moduleSlugOfLevel(db: AdminDb, levelId: string): Promise<string | null> {
  const { data } = await db.from("cc_levels").select("cc_modules(slug)").eq("id", levelId).maybeSingle<{ cc_modules: { slug: string } | { slug: string }[] | null }>();
  const m = data?.cc_modules;
  return (Array.isArray(m) ? m[0]?.slug : m?.slug) ?? null;
}

// ─── module ───────────────────────────────────────────────────────────────

export async function saveModuleAction(id: string, raw: Raw): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id))) return { ok: false, error: "not_found" };
  const v = validateModuleInput(raw ?? {});
  if (!v.ok) return bad(v.errors);
  const { data: before, error: e1 } = await g.db.from("cc_modules").select("id,slug,is_published").eq("id", id).maybeSingle<{ id: string; slug: string; is_published: boolean }>();
  if (e1) return dbError(e1, "module read");
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_modules").update(v.value).eq("id", id);
  if (error) return dbError(error, "module save");
  const action = publishAuditAction("module", before.is_published, v.value.is_published);
  if (action) await writeAudit(g.db, g.cc.user.id, action, "cc_modules", id, { is_published: before.is_published }, { is_published: v.value.is_published, slug: before.slug });
  revalidate({ moduleSlug: before.slug });
  return { ok: true };
}

// ─── level ────────────────────────────────────────────────────────────────

export async function saveLevelAction(id: string, raw: Raw): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id))) return { ok: false, error: "not_found" };
  const v = validateLevelInput(raw ?? {});
  if (!v.ok) return bad(v.errors);
  const { data: before, error: e1 } = await g.db.from("cc_levels").select("id,is_published,level_number").eq("id", id).maybeSingle<{ id: string; is_published: boolean; level_number: number }>();
  if (e1) return dbError(e1, "level read");
  if (!before) return { ok: false, error: "not_found" };
  const { unlock_rule, ...rest } = v.value;
  const patch: Record<string, unknown> = { ...rest };
  if (unlock_rule) patch.unlock_rule = unlock_rule;
  const { error } = await g.db.from("cc_levels").update(patch).eq("id", id);
  if (error) return dbError(error, "level save");
  const action = publishAuditAction("level", before.is_published, v.value.is_published);
  if (action) await writeAudit(g.db, g.cc.user.id, action, "cc_levels", id, { is_published: before.is_published }, { is_published: v.value.is_published, level_number: v.value.level_number });
  revalidate({ moduleSlug: await moduleSlugOfLevel(g.db, id) });
  return { ok: true };
}

// ─── lesson ───────────────────────────────────────────────────────────────

export async function saveLessonAction(id: string, raw: Raw): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id))) return { ok: false, error: "not_found" };
  const v = validateLessonInput(raw ?? {});
  if (!v.ok) return bad(v.errors);
  const { data: before, error: e1 } = await g.db
    .from("cc_lessons")
    .select("id,slug,level_id,is_published,is_free_preview,track_notes")
    .eq("id", id)
    .maybeSingle<{ id: string; slug: string; level_id: string; is_published: boolean; is_free_preview: boolean; track_notes: unknown }>();
  if (e1) return dbError(e1, "lesson read");
  if (!before) return { ok: false, error: "not_found" };
  const notes = buildTrackNotes(v.value.track_notes, before.track_notes);
  if (!notes.ok) return bad(notes.errors);
  const { error } = await g.db.from("cc_lessons").update({ ...v.value, track_notes: notes.value }).eq("id", id);
  if (error) return dbError(error, "lesson save");
  const pub = publishAuditAction("lesson", before.is_published, v.value.is_published);
  if (pub) await writeAudit(g.db, g.cc.user.id, pub, "cc_lessons", id, { is_published: before.is_published }, { is_published: v.value.is_published, slug: v.value.slug });
  const free = freePreviewAuditAction(before.is_free_preview, v.value.is_free_preview);
  if (free) await writeAudit(g.db, g.cc.user.id, free, "cc_lessons", id, { is_free_preview: before.is_free_preview }, { is_free_preview: v.value.is_free_preview, slug: v.value.slug });
  revalidate({ moduleSlug: await moduleSlugOfLevel(g.db, before.level_id), lessonSlugs: [before.slug, v.value.slug] });
  return { ok: true };
}

export async function createLessonAction(levelId: string, raw: { slug: string; title_en: string; title_ar: string }): Promise<ActionResult<{ id: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(levelId))) return { ok: false, error: "not_found" };
  const slug = str(raw?.slug);
  const title_en = str(raw?.title_en);
  const title_ar = str(raw?.title_ar);
  const errors: FieldErrors = {};
  if (!isSlug(slug)) errors.slug = "invalid";
  if (!title_en || title_en.length > 200) errors.title_en = "invalid";
  if (!title_ar || title_ar.length > 200) errors.title_ar = "invalid";
  if (Object.keys(errors).length) return bad(errors);
  const { data: level, error: e1 } = await g.db.from("cc_levels").select("id").eq("id", levelId).maybeSingle();
  if (e1) return dbError(e1, "create read level");
  if (!level) return { ok: false, error: "not_found" };
  const { data: siblings, error: e2 } = await g.db.from("cc_lessons").select("sort").eq("level_id", levelId);
  if (e2) return dbError(e2, "create siblings");
  const sort = nextSort(((siblings ?? []) as { sort: number }[]).map((s) => s.sort));
  const { data, error } = await g.db
    .from("cc_lessons")
    .insert({ level_id: levelId, slug, title_en, title_ar, sort, is_published: false, is_free_preview: false })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) return dbError(error ?? {}, "lesson create");
  await writeAudit(g.db, g.cc.user.id, "lesson.create", "cc_lessons", data.id, null, { slug, title_en, level_id: levelId });
  revalidate({ moduleSlug: await moduleSlugOfLevel(g.db, levelId), lessonSlugs: [slug] });
  return { ok: true, data: { id: data.id } };
}

export async function deleteLessonAction(id: string): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id))) return { ok: false, error: "not_found" };
  const { data: before, error: e1 } = await g.db
    .from("cc_lessons")
    .select("id,slug,level_id,title_en,title_ar,is_published,is_free_preview")
    .eq("id", id)
    .maybeSingle<{ id: string; slug: string; level_id: string; title_en: string; title_ar: string; is_published: boolean; is_free_preview: boolean }>();
  if (e1) return dbError(e1, "delete read");
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_lessons").delete().eq("id", id);
  if (error) return dbError(error, "lesson delete");
  await writeAudit(g.db, g.cc.user.id, "lesson.delete", "cc_lessons", id, before, null);
  revalidate({ moduleSlug: await moduleSlugOfLevel(g.db, before.level_id), lessonSlugs: [before.slug] });
  return { ok: true };
}

export async function moveLessonAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id)) || (direction !== "up" && direction !== "down")) return { ok: false, error: "invalid" };
  const { data: row, error: e1 } = await g.db.from("cc_lessons").select("id,level_id,slug").eq("id", id).maybeSingle<{ id: string; level_id: string; slug: string }>();
  if (e1) return dbError(e1, "move read");
  if (!row) return { ok: false, error: "not_found" };
  const { data: siblings, error: e2 } = await g.db.from("cc_lessons").select("id,sort").eq("level_id", row.level_id).order("sort", { ascending: true });
  if (e2) return dbError(e2, "move siblings");
  const changes = computeReorder((siblings ?? []) as { id: string; sort: number }[], id, direction);
  for (const c of changes) {
    const { error } = await g.db.from("cc_lessons").update({ sort: c.sort }).eq("id", c.id);
    if (error) return dbError(error, "move save");
  }
  revalidate({ moduleSlug: await moduleSlugOfLevel(g.db, row.level_id) });
  return { ok: true };
}

// ─── quick toggles from the tree ──────────────────────────────────────────

export async function setPublishedAction(input: { entity: "module" | "level" | "lesson"; id: string; published: boolean }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const { entity, id } = input ?? ({} as typeof input);
  if (!UUID.test(String(id)) || typeof input.published !== "boolean" || !["module", "level", "lesson"].includes(entity)) return { ok: false, error: "invalid" };
  const table = entity === "module" ? "cc_modules" : entity === "level" ? "cc_levels" : "cc_lessons";
  const { data: before, error: e1 } = await g.db.from(table).select("id,is_published").eq("id", id).maybeSingle<{ id: string; is_published: boolean }>();
  if (e1) return dbError(e1, "publish read");
  if (!before) return { ok: false, error: "not_found" };
  if (before.is_published === input.published) return { ok: true };
  const { error } = await g.db.from(table).update({ is_published: input.published }).eq("id", id);
  if (error) return dbError(error, "publish save");
  const action = publishAuditAction(entity, before.is_published, input.published)!;
  await writeAudit(g.db, g.cc.user.id, action, table, id, { is_published: before.is_published }, { is_published: input.published });
  revalidate({});
  return { ok: true };
}

export async function setFreePreviewAction(input: { id: string; value: boolean }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(input?.id)) || typeof input.value !== "boolean") return { ok: false, error: "invalid" };
  const { data: before, error: e1 } = await g.db.from("cc_lessons").select("id,slug,is_free_preview").eq("id", input.id).maybeSingle<{ id: string; slug: string; is_free_preview: boolean }>();
  if (e1) return dbError(e1, "free preview read");
  if (!before) return { ok: false, error: "not_found" };
  const action = freePreviewAuditAction(before.is_free_preview, input.value);
  if (!action) return { ok: true };
  const { error } = await g.db.from("cc_lessons").update({ is_free_preview: input.value }).eq("id", input.id);
  if (error) return dbError(error, "free preview save");
  await writeAudit(g.db, g.cc.user.id, action, "cc_lessons", input.id, { is_free_preview: before.is_free_preview }, { is_free_preview: input.value, slug: before.slug });
  revalidate({ lessonSlugs: [before.slug] });
  return { ok: true };
}
