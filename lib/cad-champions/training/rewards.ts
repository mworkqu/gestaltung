// XP, weekly streak, badges and certificates — SERVER ONLY (service role).
// Students can only READ cc_student_xp / cc_badges / cc_certificates (RLS,
// 0083), so the actions write them here after checking auth themselves.
// Never throws; before 0083 every call is a quiet no-op.

import { randomBytes } from "node:crypto";

import { CERTIFICATE_MODULES } from "./catalog";
import { generateCertificateCode } from "./certificate";
import { nextStreak, qatarWeekStart } from "./gamification";
import { isMissingSchema, loadCatalog, loadProgress, moduleView, type Db } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/training/rewards.ts is server-only");

const FULL = { enrolled: true, staff: false };

async function readXp(db: Db, userId: string) {
  const { data, error } = await db
    .from("cc_student_xp")
    .select("xp,streak_weeks,last_active_week")
    .eq("user_id", userId)
    .maybeSingle<{ xp: number; streak_weeks: number; last_active_week: string | null }>();
  if (error) {
    if (!isMissingSchema(error.code)) console.error("[cc-rewards] xp read failed:", error.code ?? error.message);
    return { ok: false as const };
  }
  return { ok: true as const, row: data };
}

/** Adds XP (may be 0) and counts this week for the streak. */
export async function recordActivity(db: Db, userId: string, addXp = 0, now: Date = new Date()): Promise<void> {
  try {
    const cur = await readXp(db, userId);
    if (!cur.ok) return;
    const streak = nextStreak(cur.row ? { streakWeeks: cur.row.streak_weeks, lastActiveWeek: cur.row.last_active_week } : null, qatarWeekStart(now));
    const xp = Math.max(0, (cur.row?.xp ?? 0) + Math.max(0, Math.floor(addXp)));
    if (!streak.changed && addXp <= 0 && cur.row) return;
    const { error } = await db
      .from("cc_student_xp")
      .upsert({ user_id: userId, xp, streak_weeks: streak.streakWeeks, last_active_week: streak.lastActiveWeek, updated_at: now.toISOString() }, { onConflict: "user_id" });
    if (error) console.error("[cc-rewards] xp write failed:", error.code ?? error.message);
  } catch (e) {
    console.error("[cc-rewards] activity failed:", e instanceof Error ? e.message : "unknown");
  }
}

export interface RewardResult {
  /** Level ids that earned a badge just now. */
  newBadges: string[];
  /** Certificate code issued just now. */
  certificateCode: string | null;
}

/**
 * Badges for every completed level of a module and a certificate when the
 * whole module is done (only for CERTIFICATE_MODULES). Idempotent.
 */
export async function refreshModuleRewards(db: Db, userId: string, moduleId: string): Promise<RewardResult> {
  const result: RewardResult = { newBadges: [], certificateCode: null };
  try {
    const catalog = await loadCatalog(db);
    if (!catalog.ok) return result;
    const mod = catalog.modules.find((m) => m.id === moduleId);
    if (!mod) return result;
    const progress = await loadProgress(userId, catalog.modules, db);
    const view = moduleView(mod, progress, FULL);

    const completed = view.states.filter((s) => s.status === "completed").map((s) => s.id);
    const missing = completed.filter((id) => !progress.badges.has(id));
    if (missing.length > 0) {
      const { data, error } = await db
        .from("cc_badges")
        .upsert(
          missing.map((level_id) => ({ user_id: userId, level_id })),
          { onConflict: "user_id,level_id", ignoreDuplicates: true }
        )
        .select("level_id");
      if (error) console.error("[cc-rewards] badge write failed:", error.code ?? error.message);
      else result.newBadges = ((data ?? []) as { level_id: string }[]).map((r) => r.level_id);
    }

    const hasCert = progress.certificates.some((c) => c.moduleId === moduleId);
    if (view.progress.complete && !hasCert && CERTIFICATE_MODULES.includes(mod.slug)) {
      for (let i = 0; i < 4; i++) {
        const code = generateCertificateCode((n) => new Uint8Array(randomBytes(n)));
        const { error } = await db.from("cc_certificates").insert({ user_id: userId, module_id: moduleId, code });
        if (!error) {
          result.certificateCode = code;
          break;
        }
        if (error.code !== "23505") {
          console.error("[cc-rewards] certificate write failed:", error.code ?? error.message);
          break;
        }
        // 23505: same code (retry) or the certificate exists already (stop on the next read)
        const { data: existing } = await db.from("cc_certificates").select("code").eq("user_id", userId).eq("module_id", moduleId).maybeSingle<{ code: string }>();
        if (existing) break;
      }
    }
  } catch (e) {
    console.error("[cc-rewards] refresh failed:", e instanceof Error ? e.message : "unknown");
  }
  return result;
}
