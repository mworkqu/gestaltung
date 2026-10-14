// Journey timestamps (cc_journey_progress) — SERVER ONLY. Never import into a
// client component (uses the service-role client).
//
// Students can only READ their journey row (RLS), so the server writes it with
// the service role after checking auth itself. The caller is responsible for
// that check: pass only the id of the signed-in user (getCcUser().user.id).

import { createServiceClient } from "@/lib/supabase/service";

import type { CcJourneyProgress } from "../db/types";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/journey/server.ts is server-only");

export const CC_JOURNEY_KEYS = [
  "profile_completed_at",
  "get_ready_completed_at",
  "practice_passed_at",
  "first_test_submitted_at",
  "results_viewed_at",
  "sample_lesson_watched_at",
  "enrolled_at",
] as const satisfies readonly (keyof CcJourneyProgress)[];

export type CcJourneyKey = (typeof CC_JOURNEY_KEYS)[number];

export function isCcJourneyKey(value: unknown): value is CcJourneyKey {
  return typeof value === "string" && (CC_JOURNEY_KEYS as readonly string[]).includes(value);
}

/**
 * Stamps one journey timestamp for `userId`, only if it is still empty
 * (idempotent: the first time wins). Creates the journey row if it is
 * missing. Never throws; returns true when this call set the value.
 */
export async function markJourney(userId: string, key: CcJourneyKey, at: Date = new Date()): Promise<boolean> {
  if (!userId || !isCcJourneyKey(key)) return false;
  const service = createServiceClient();
  if (!service) {
    console.warn("[cc-journey] SUPABASE_SERVICE_ROLE_KEY missing; not recorded:", key);
    return false;
  }
  const iso = at.toISOString();
  try {
    const { data, error } = await service
      .from("cc_journey_progress")
      .update({ [key]: iso })
      .eq("user_id", userId)
      .is(key, null)
      .select("user_id");
    if (error) {
      console.error("[cc-journey] update failed:", key, error.code ?? error.message);
      return false;
    }
    if (data && data.length > 0) return true;

    // Nothing updated: either already set (done) or no row yet (the profile
    // trigger normally creates it). Insert-if-missing, then never overwrite.
    const { data: inserted, error: insertError } = await service
      .from("cc_journey_progress")
      .upsert({ user_id: userId, [key]: iso }, { onConflict: "user_id", ignoreDuplicates: true })
      .select("user_id");
    if (insertError) {
      console.error("[cc-journey] insert failed:", key, insertError.code ?? insertError.message);
      return false;
    }
    return !!inserted && inserted.length > 0;
  } catch (e) {
    console.error("[cc-journey] failed:", key, e instanceof Error ? e.message : "unknown");
    return false;
  }
}
