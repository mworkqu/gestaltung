import "server-only";

// The two reads behind the dashboard training line
// (components/cad-champions/training/stats.tsx), moved out of the component
// unchanged (R11). Takes the cookie (RLS) server client.

import type { DbClient } from "@/lib/supabase/db";

export type TrainingStatsRows = {
  xp: { xp: number; streak_weeks: number; last_active_week: string | null } | null;
  error: unknown;
  badgeCount: number | null;
};

export async function loadTrainingStats(db: DbClient, userId: string): Promise<TrainingStatsRows> {
  const [{ data: xp, error }, { count }] = await Promise.all([
    db.from("cc_student_xp").select("xp,streak_weeks,last_active_week").eq("user_id", userId).maybeSingle<{ xp: number; streak_weeks: number; last_active_week: string | null }>(),
    db.from("cc_badges").select("level_id", { count: "exact", head: true }).eq("user_id", userId),
  ]);
  return { xp, error, badgeCount: count };
}
