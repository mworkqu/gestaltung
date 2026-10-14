"use server";

import { revalidatePath } from "next/cache";

import { validateHelpArticle, type HelpArticleInput } from "@/lib/cad-champions/admin/help";
import { adminGuard, isMissingSchema, writeAudit, type ActionResult } from "@/lib/cad-champions/admin/server";
import { publishAuditAction, type FieldErrors } from "@/lib/cad-champions/admin/lessons";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Help Center admin actions (Prompt 11). Admin only: adminGuard("admin") on
// every call, validation, audit for publish / unpublish / delete, and
// revalidation of the admin list plus the public Help Center in both locales.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bad(errors: FieldErrors): { ok: false; error: "invalid"; detail: string } {
  return { ok: false, error: "invalid", detail: Object.keys(errors).join(",") };
}

function dbError(error: { code?: string; message?: string }, label: string): { ok: false; error: "not_set_up" | "conflict" | "error" } {
  if (isMissingSchema(error.code)) return { ok: false, error: "not_set_up" };
  if (error.code === "23505") return { ok: false, error: "conflict" };
  console.error(`[cc-admin-help] ${label} failed:`, error.code ?? error.message ?? "unknown");
  return { ok: false, error: "error" };
}

function revalidate(slugs: (string | null | undefined)[]) {
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/admin/help"));
    revalidatePath(ccPath(l, "/help"));
    for (const s of slugs) if (s) revalidatePath(ccPath(l, `/help/${s}`));
  }
}

export async function createHelpArticleAction(raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  const v = validateHelpArticle(raw ?? {});
  if (!v.ok) return bad(v.errors);
  const { data, error } = await g.db.from("cc_help_articles").insert(v.value).select("id").single<{ id: string }>();
  if (error || !data) return dbError(error ?? {}, "create");
  await writeAudit(g.db, g.cc.user.id, "help.create", "cc_help_articles", data.id, null, { slug: v.value.slug, is_published: v.value.is_published });
  if (v.value.is_published) await writeAudit(g.db, g.cc.user.id, "help.publish", "cc_help_articles", data.id, { is_published: false }, { is_published: true, slug: v.value.slug });
  revalidate([v.value.slug]);
  return { ok: true, data: { id: data.id } };
}

export async function saveHelpArticleAction(id: string, raw: Record<string, unknown>): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id))) return { ok: false, error: "not_found" };
  const v = validateHelpArticle(raw ?? {});
  if (!v.ok) return bad(v.errors);
  const { data: before, error: e1 } = await g.db.from("cc_help_articles").select("id,slug,is_published").eq("id", id).maybeSingle<{ id: string; slug: string; is_published: boolean }>();
  if (e1) return dbError(e1, "read");
  if (!before) return { ok: false, error: "not_found" };
  const value: HelpArticleInput = v.value;
  const { error } = await g.db.from("cc_help_articles").update(value).eq("id", id);
  if (error) return dbError(error, "save");
  const action = publishAuditAction("help", before.is_published, value.is_published);
  if (action) await writeAudit(g.db, g.cc.user.id, action, "cc_help_articles", id, { is_published: before.is_published }, { is_published: value.is_published, slug: value.slug });
  revalidate([before.slug, value.slug]);
  return { ok: true };
}

export async function setHelpPublishedAction(input: { id: string; published: boolean }): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(input?.id)) || typeof input.published !== "boolean") return { ok: false, error: "invalid" };
  const { data: before, error: e1 } = await g.db
    .from("cc_help_articles")
    .select("id,slug,is_published,body_en,body_ar")
    .eq("id", input.id)
    .maybeSingle<{ id: string; slug: string; is_published: boolean; body_en: string; body_ar: string }>();
  if (e1) return dbError(e1, "publish read");
  if (!before) return { ok: false, error: "not_found" };
  if (before.is_published === input.published) return { ok: true };
  if (input.published && (!before.body_en?.trim() || !before.body_ar?.trim())) return { ok: false, error: "invalid", detail: "is_published" };
  const { error } = await g.db.from("cc_help_articles").update({ is_published: input.published }).eq("id", input.id);
  if (error) return dbError(error, "publish save");
  await writeAudit(g.db, g.cc.user.id, input.published ? "help.publish" : "help.unpublish", "cc_help_articles", input.id, { is_published: before.is_published }, { is_published: input.published, slug: before.slug });
  revalidate([before.slug]);
  return { ok: true };
}

export async function deleteHelpArticleAction(id: string): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return g;
  if (!UUID.test(String(id))) return { ok: false, error: "not_found" };
  const { data: before, error: e1 } = await g.db.from("cc_help_articles").select("*").eq("id", id).maybeSingle<Record<string, unknown> & { slug: string }>();
  if (e1) return dbError(e1, "delete read");
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_help_articles").delete().eq("id", id);
  if (error) return dbError(error, "delete");
  await writeAudit(g.db, g.cc.user.id, "help.delete", "cc_help_articles", id, before, null);
  revalidate([before.slug]);
  return { ok: true };
}
