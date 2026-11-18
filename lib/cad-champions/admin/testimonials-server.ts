// cc_testimonials — SERVER ONLY (Prompt 11, landing editor).
//   loadPublishedTestimonials()   public read for the landing (cookie-free anon, cached 5 min,
//                                 tag CC_TESTIMONIALS_TAG; [] before migration 0085 or on any error)
//   listTestimonials()            admin read (all rows)
//   create / update / delete / move / setPublished    admin writes, audited

import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";

import { ccPath, CC_LOCALES } from "@/lib/cad-champions/routes";
import { createPublicClient } from "@/lib/supabase/public";

import { adminGuard, isMissingSchema, writeAudit, type ActionResult, type AdminDb } from "./server";
import { moveTestimonial, nextSort, parseTestimonialInput, sortTestimonials, type TestimonialRow } from "./testimonials";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/testimonials-server.ts is server-only");

export const CC_TESTIMONIALS_TAG = "cc-testimonials";

const COLUMNS = "id,quote_en,quote_ar,name_en,name_ar,role_en,role_ar,sort,is_published";

const readPublished = unstable_cache(
  async (): Promise<TestimonialRow[]> => {
    const db = createPublicClient();
    if (!db) return [];
    try {
      const { data, error } = await db.from("cc_testimonials").select(COLUMNS).eq("is_published", true).order("sort", { ascending: true }).limit(60);
      if (error) {
        if (!["42P01", "PGRST205", "PGRST204"].includes(error.code ?? "")) console.error("[cc-testimonials] read failed:", error.code ?? error.message);
        return [];
      }
      return (data ?? []) as TestimonialRow[];
    } catch (e) {
      console.error("[cc-testimonials] read failed:", e instanceof Error ? e.message : "unknown");
      return [];
    }
  },
  ["cc-testimonials-published-v1"],
  { revalidate: 300, tags: [CC_TESTIMONIALS_TAG] },
);

export async function loadPublishedTestimonials(): Promise<TestimonialRow[]> {
  try {
    return sortTestimonials(await readPublished());
  } catch {
    return [];
  }
}

function refresh() {
  try {
    revalidateTag(CC_TESTIMONIALS_TAG);
  } catch {
    // outside a request
  }
  for (const l of CC_LOCALES) {
    revalidatePath(ccPath(l, "/"));
    revalidatePath(ccPath(l, "/admin/landing"));
  }
}

export async function listTestimonials(): Promise<{ ok: true; rows: TestimonialRow[] } | { ok: false; reason: "forbidden" | "unavailable" | "not_set_up" | "error" }> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, reason: g.error };
  const { data, error } = await g.db.from("cc_testimonials").select(COLUMNS).order("sort", { ascending: true }).limit(200);
  if (error) return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
  return { ok: true, rows: sortTestimonials((data ?? []) as TestimonialRow[]) };
}

async function allRows(db: AdminDb) {
  const { data, error } = await db.from("cc_testimonials").select("id,sort").limit(500);
  return { rows: (data ?? []) as Pick<TestimonialRow, "id" | "sort">[], error };
}

export async function createTestimonial(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  const p = parseTestimonialInput(raw);
  if (!p.ok) return { ok: false, error: "invalid", detail: p.field };
  const list = await allRows(g.db);
  if (list.error) return { ok: false, error: isMissingSchema(list.error.code) ? "not_set_up" : "error" };
  const row = { ...p.value, role_en: p.value.role_en || null, role_ar: p.value.role_ar || null, sort: nextSort(list.rows), is_published: false };
  const { data, error } = await g.db.from("cc_testimonials").insert(row).select("id").single();
  if (error || !data) return { ok: false, error: isMissingSchema(error?.code) ? "not_set_up" : "error" };
  await writeAudit(g.db, g.cc.user.id, "testimonial.create", "testimonial", data.id as string, null, row);
  refresh();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateTestimonial(id: unknown, raw: unknown): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || id.length < 8) return { ok: false, error: "invalid" };
  const p = parseTestimonialInput(raw);
  if (!p.ok) return { ok: false, error: "invalid", detail: p.field };
  const { data: before, error: e1 } = await g.db.from("cc_testimonials").select(COLUMNS).eq("id", id).maybeSingle();
  if (e1) return { ok: false, error: isMissingSchema(e1.code) ? "not_set_up" : "error" };
  if (!before) return { ok: false, error: "not_found" };
  const patch = { ...p.value, role_en: p.value.role_en || null, role_ar: p.value.role_ar || null };
  const { error } = await g.db.from("cc_testimonials").update(patch).eq("id", id);
  if (error) return { ok: false, error: "error" };
  await writeAudit(g.db, g.cc.user.id, "testimonial.update", "testimonial", id, before, patch);
  refresh();
  return { ok: true };
}

export async function setTestimonialPublished(id: unknown, published: unknown): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || id.length < 8 || typeof published !== "boolean") return { ok: false, error: "invalid" };
  const { data: before, error: e1 } = await g.db.from("cc_testimonials").select("id,is_published").eq("id", id).maybeSingle();
  if (e1) return { ok: false, error: isMissingSchema(e1.code) ? "not_set_up" : "error" };
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_testimonials").update({ is_published: published }).eq("id", id);
  if (error) return { ok: false, error: "error" };
  await writeAudit(g.db, g.cc.user.id, published ? "testimonial.publish" : "testimonial.unpublish", "testimonial", id, { is_published: before.is_published }, { is_published: published });
  refresh();
  return { ok: true };
}

export async function deleteTestimonial(id: unknown): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || id.length < 8) return { ok: false, error: "invalid" };
  const { data: before, error: e1 } = await g.db.from("cc_testimonials").select(COLUMNS).eq("id", id).maybeSingle();
  if (e1) return { ok: false, error: isMissingSchema(e1.code) ? "not_set_up" : "error" };
  if (!before) return { ok: false, error: "not_found" };
  const { error } = await g.db.from("cc_testimonials").delete().eq("id", id);
  if (error) return { ok: false, error: "error" };
  await writeAudit(g.db, g.cc.user.id, "testimonial.delete", "testimonial", id, before, null);
  refresh();
  return { ok: true };
}

export async function moveTestimonialRow(id: unknown, dir: unknown): Promise<ActionResult> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };
  if (typeof id !== "string" || (dir !== "up" && dir !== "down")) return { ok: false, error: "invalid" };
  const list = await allRows(g.db);
  if (list.error) return { ok: false, error: isMissingSchema(list.error.code) ? "not_set_up" : "error" };
  const changes = moveTestimonial(list.rows, id, dir);
  for (const c of changes) {
    const { error } = await g.db.from("cc_testimonials").update({ sort: c.sort }).eq("id", c.id);
    if (error) return { ok: false, error: "error" };
  }
  if (changes.length > 0) refresh();
  return { ok: true };
}
