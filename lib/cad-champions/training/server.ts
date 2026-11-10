// Training data on the server (Prompt 9) — SERVER ONLY.
//
// Reads use the student's own session (RLS: published content, own progress)
// unless a function takes a client argument (the actions pass the service
// client after checking auth themselves). Everything degrades gracefully
// before migration 0083 has run ({ ok: false, reason: "not_set_up" }).
// Answers never pass through here: exercises are read from the
// cc_exercises_public view; hints / solution ids only in actions.ts.

import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import type { CcUser } from "../auth/server";
import type { CcSkillAreaId } from "../db/types";
import { OFFICIAL_WEIGHTS } from "../scoring/config";
import { recommendTrainingPath, type PathStep } from "../scoring/core";
import type { AccessContext } from "./access";
import { MODULE_FOR_SKILL_AREA } from "./catalog";
import {
  isMissingSchema,
  loadCatalogWith,
  loadProgressWith,
  moduleView,
  pick,
  type CatalogModule,
  type CatalogResult,
  type Db,
  type ModuleView,
  type TrainingProgress,
} from "./data";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/training/server.ts is server-only");

async function userDb(): Promise<Db> {
  return (await createClient()) as unknown as Db;
}

// ─── access ──────────────────────────────────────────────────────────────

/** enrolled = cc_has_active_enrollment(user); staff from the session. Never throws. */
export async function getAccessContext(cc: CcUser): Promise<AccessContext> {
  if (cc.isStaff) return { enrolled: true, staff: true };
  try {
    const db = await userDb();
    const { data, error } = await db.rpc("cc_has_active_enrollment", { p_user: cc.user.id });
    if (error) {
      if (!isMissingSchema(error.code)) console.error("[cc-training] enrollment check failed:", error.code ?? error.message);
      return { enrolled: false, staff: false };
    }
    return { enrolled: data === true, staff: false };
  } catch (e) {
    console.error("[cc-training] enrollment check failed:", e instanceof Error ? e.message : "unknown");
    return { enrolled: false, staff: false };
  }
}

// ─── catalog + progress (./data.ts) ────────────────────────────────────

export * from "./data";

/**
 * The whole published catalog (no notes, no answers). `client` defaults to
 * the student's session; actions pass the service client (then only
 * published rows are read, filtered here).
 */
export function loadCatalog(client?: Db): Promise<CatalogResult> {
  return loadCatalogWith(client ? async () => client : userDb, !!client);
}

/** Progress of one student. `client` = service client (actions) or the student's session (pages). */
export function loadProgress(userId: string, catalog: CatalogModule[], client?: Db): Promise<TrainingProgress> {
  return loadProgressWith(userId, catalog, client ? async () => client : userDb);
}

export interface Recommendation {
  step: PathStep;
  module: CatalogModule;
  levelNumber: number | null;
}

/** "Recommended for you": the latest scored attempt's skill map -> modules. */
export async function loadRecommendations(userId: string, catalog: CatalogModule[]): Promise<Recommendation[]> {
  try {
    const db = await userDb();
    const { data: attempt } = await db
      .from("cc_attempts")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["provisional", "graded"])
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!attempt) return [];
    const { data: scores } = await db.from("cc_skill_scores").select("skill_area_id,percent,assessed").eq("attempt_id", attempt.id);
    const areas = ((scores ?? []) as { skill_area_id: CcSkillAreaId; percent: number | string | null; assessed: boolean }[]).map((s) => ({
      skillAreaId: s.skill_area_id,
      weight: OFFICIAL_WEIGHTS[s.skill_area_id] ?? 0,
      percent: s.percent == null ? null : Number(s.percent),
      assessed: s.assessed,
    }));
    const out: Recommendation[] = [];
    for (const step of recommendTrainingPath(areas).slice(0, 3)) {
      const target = MODULE_FOR_SKILL_AREA[step.skillAreaId];
      const found = catalog.find((m) => m.slug === target?.module);
      if (found) out.push({ step, module: found, levelNumber: target?.level ?? null });
    }
    return out;
  } catch (e) {
    console.error("[cc-training] recommendations failed:", e instanceof Error ? e.message : "unknown");
    return [];
  }
}

// ─── signed file links ───────────────────────────────────────────────────

export interface FileLink {
  label: string;
  url: string;
}

/** Signed links (10 minutes) for [{path, label_en, label_ar}] in a private bucket. Service role; call only after the access check. */
export async function signedFileLinks(bucket: string, files: unknown, locale: Locale): Promise<FileLink[]> {
  if (!Array.isArray(files) || files.length === 0) return [];
  const service = createServiceClient();
  if (!service) return [];
  const out: FileLink[] = [];
  for (const f of files.slice(0, 20)) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const path = typeof o.path === "string" ? o.path : "";
    if (!path || path.includes("..")) continue;
    const { data } = await service.storage.from(bucket).createSignedUrl(path, 600);
    if (!data?.signedUrl) continue;
    const label = pick(locale, typeof o.label_en === "string" ? o.label_en : "", typeof o.label_ar === "string" ? o.label_ar : "") || (path.split("/").pop() ?? path);
    out.push({ label, url: data.signedUrl });
  }
  return out;
}

// ─── page state ──────────────────────────────────────────────────────────

export type TrainingState =
  | { ok: true; catalog: CatalogModule[]; progress: TrainingProgress; access: AccessContext; views: ModuleView[] }
  | { ok: false; reason: "not_set_up" | "error" };

/** Everything a training page needs for the signed-in student. */
export async function loadTrainingState(cc: CcUser): Promise<TrainingState> {
  const [catalog, access] = await Promise.all([loadCatalog(), getAccessContext(cc)]);
  if (!catalog.ok) return catalog;
  const progress = await loadProgress(cc.user.id, catalog.modules);
  return { ok: true, catalog: catalog.modules, progress, access, views: catalog.modules.map((m) => moduleView(m, progress, access)) };
}
