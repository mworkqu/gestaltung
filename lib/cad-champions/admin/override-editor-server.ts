// Content-override editors — SERVER ONLY (Prompt 11). One generic save used by
// the Get Ready, Glossary and Landing editors, plus the readers they share.
//
//   saveOverrides(entries, scope)  admin only; validates, upserts / deletes rows
//                                  (empty value = delete = back to the message-file
//                                  default), writes the audit log, revalidates.
//   loadOverrideMaps()             saved rows of both locales as Maps (admin read, fresh).
//   loadRawMessages()              the CC message tree (files only, no overrides) per locale.

import { revalidatePath } from "next/cache";
import { getMessages } from "next-intl/server";

import { revalidateContentOverrides } from "@/lib/cad-champions/content/overrides-server";
import { toOverrideMap, type OverrideRow } from "@/lib/cad-champions/content/overrides";
import { ccPath, CC_LOCALES } from "@/lib/cad-champions/routes";

import {
  MAX_ENTRIES_PER_SAVE,
  checkEntry,
  onlyChanged,
  planWrites,
  type OverrideEntry,
} from "./override-editor";
import { adminGuard, isMissingSchema, writeAudit, type ActionResult, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/override-editor-server.ts is server-only");

export interface SaveScope {
  /** Audit entity id, e.g. "get-ready". */
  name: string;
  /** Only keys the calling editor may write. */
  allow: (key: string) => boolean;
  /** CC paths (without locale) to revalidate, e.g. ["/get-ready"]. */
  paths: string[];
}

/** The CC message tree (what the message files say, never the overrides) of one locale. */
export async function loadRawMessages(locale: "en" | "ar"): Promise<Record<string, unknown>> {
  const all = (await getMessages({ locale })) as Record<string, unknown>;
  return ((all.CC ?? {}) as Record<string, unknown>) ?? {};
}

async function readRows(db: AdminDb, keys?: string[]): Promise<{ rows: OverrideRow[]; error?: string }> {
  let q = db.from("cc_content_overrides").select("key,locale,value").limit(5000);
  if (keys && keys.length > 0) q = q.in("key", keys);
  const { data, error } = await q;
  if (error) return { rows: [], error: error.code ?? error.message };
  return { rows: (data ?? []) as OverrideRow[] };
}

/** Saved overrides of both locales (fresh from the database, not the 5-minute cache). */
export async function loadOverrideMaps(): Promise<
  { ok: true; en: Map<string, string>; ar: Map<string, string> } | { ok: false; reason: "not_set_up" | "error" | "unavailable" | "forbidden" }
> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, reason: g.error };
  const { rows, error } = await readRows(g.db);
  if (error) return { ok: false, reason: isMissingSchema(error) ? "not_set_up" : "error" };
  return { ok: true, en: toOverrideMap(rows, "en"), ar: toOverrideMap(rows, "ar") };
}

export async function saveOverrides(input: unknown, scope: SaveScope): Promise<ActionResult<{ saved: number }>> {
  const g = await adminGuard("admin");
  if (!g.ok) return { ok: false, error: g.error };

  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ENTRIES_PER_SAVE) return { ok: false, error: "invalid" };
  const entries: OverrideEntry[] = [];
  for (const raw of input) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    if (typeof r.key !== "string") return { ok: false, error: "invalid" };
    entries.push({ key: r.key, en: typeof r.en === "string" ? r.en : "", ar: typeof r.ar === "string" ? r.ar : "" });
  }

  const messages = await loadRawMessages("en");
  for (const e of entries) {
    const issue = checkEntry(e, { messages, allow: scope.allow });
    if (issue) return { ok: false, error: "invalid", detail: `${issue}:${e.key}` };
  }

  const keys = [...new Set(entries.map((e) => e.key))];
  const before = await readRows(g.db, keys);
  if (before.error) return { ok: false, error: isMissingSchema(before.error) ? "not_set_up" : "error" };
  const existing = new Map(before.rows.map((r) => [`${r.key}|${r.locale}`, r.value]));

  const writes = onlyChanged(planWrites(entries), existing);
  if (writes.length === 0) return { ok: true, data: { saved: 0 } };

  const upserts = writes
    .filter((w) => w.value !== null)
    .map((w) => ({ key: w.key, locale: w.locale, value: w.value as string, updated_by: g.cc.user.id }));
  if (upserts.length > 0) {
    const { error } = await g.db.from("cc_content_overrides").upsert(upserts, { onConflict: "key,locale" });
    if (error) return { ok: false, error: isMissingSchema(error.code) ? "not_set_up" : "error" };
  }
  for (const w of writes.filter((x) => x.value === null)) {
    const { error } = await g.db.from("cc_content_overrides").delete().eq("key", w.key).eq("locale", w.locale);
    if (error) return { ok: false, error: isMissingSchema(error.code) ? "not_set_up" : "error" };
  }

  const beforeObj: Record<string, string | null> = {};
  const afterObj: Record<string, string | null> = {};
  for (const w of writes) {
    const k = `${w.key}|${w.locale}`;
    beforeObj[k] = existing.get(k) ?? null;
    afterObj[k] = w.value;
  }
  await writeAudit(g.db, g.cc.user.id, "content.override", "content_override", scope.name, beforeObj, afterObj);

  revalidateContentOverrides();
  for (const l of CC_LOCALES) {
    for (const p of scope.paths) revalidatePath(ccPath(l, p));
    revalidatePath(ccPath(l, `/admin/${scope.name}`));
  }
  return { ok: true, data: { saved: keys.length } };
}
