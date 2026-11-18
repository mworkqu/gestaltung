// Get Ready progress (cc_get_ready_steps) — SERVER ONLY.
//
// Reads and writes go through the student's own RLS client: students may
// select / insert / update / delete their own rows (0077 policies). The
// caller passes the id of the signed-in user (getCcUser().user.id); RLS
// rejects any other id anyway. Exception: the grader-only key
// "practice_upload" is written with the service role, because migration 0087
// (SR-L3) stops students inserting it themselves. When every required step is done the journey
// stamp get_ready_completed_at is written (service role, idempotent).

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

import { markJourney } from "../journey/server";
import {
  allSubItemsTicked,
  computeGetReady,
  getStepDef,
  isSubItemOf,
  subItemKey,
  type GetReadyStepKey,
} from "./steps";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/get-ready/server.ts is server-only");

export type GetReadyRead = { ok: true; keys: string[] } | { ok: false; reason: "not_set_up" | "error" };

export type GetReadyWrite =
  | { ok: true; keys: string[]; complete: boolean; justCompleted: boolean }
  | { ok: false; reason: "not_set_up" | "error" };

function isMissingTable(code: string | undefined): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204";
}

/** Every stored key (step keys and checklist ticks) for one user. */
export async function readGetReadySteps(userId: string): Promise<GetReadyRead> {
  if (!userId) return { ok: false, reason: "error" };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("cc_get_ready_steps").select("step_key").eq("user_id", userId);
    if (error) {
      if (isMissingTable(error.code)) return { ok: false, reason: "not_set_up" };
      console.error("[cc-get-ready] read failed:", error.code ?? error.message);
      return { ok: false, reason: "error" };
    }
    return { ok: true, keys: (data ?? []).map((r: { step_key: string }) => r.step_key) };
  } catch (e) {
    console.error("[cc-get-ready] read failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Keys only the server may write (the grader passed the practice file). */
const SERVER_ONLY_KEYS: readonly string[] = ["practice_upload"];

async function upsertKeys(userId: string, keys: string[]): Promise<{ ok: true } | { ok: false; reason: "not_set_up" | "error" }> {
  const serverOnly = keys.some((k) => SERVER_ONLY_KEYS.includes(k));
  const supabase = serverOnly ? createServiceClient() : await createClient();
  if (!supabase) return { ok: false, reason: "error" };
  const { error } = await supabase
    .from("cc_get_ready_steps")
    .upsert(
      keys.map((step_key) => ({ user_id: userId, step_key })),
      { onConflict: "user_id,step_key", ignoreDuplicates: true }
    );
  if (error) {
    if (isMissingTable(error.code)) return { ok: false, reason: "not_set_up" };
    console.error("[cc-get-ready] write failed:", error.code ?? error.message);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

async function deleteKeys(userId: string, keys: string[]): Promise<{ ok: true } | { ok: false; reason: "not_set_up" | "error" }> {
  const supabase = await createClient();
  const { error } = await supabase.from("cc_get_ready_steps").delete().eq("user_id", userId).in("step_key", keys);
  if (error) {
    if (isMissingTable(error.code)) return { ok: false, reason: "not_set_up" };
    console.error("[cc-get-ready] delete failed:", error.code ?? error.message);
    return { ok: false, reason: "error" };
  }
  return { ok: true };
}

/** Re-reads the keys and stamps the journey when every required step is done. */
async function finish(userId: string, wasComplete: boolean): Promise<GetReadyWrite> {
  const read = await readGetReadySteps(userId);
  if (!read.ok) return read;
  const { complete } = computeGetReady(read.keys);
  if (complete) await markJourney(userId, "get_ready_completed_at");
  return { ok: true, keys: read.keys, complete, justCompleted: complete && !wasComplete };
}

/**
 * Marks one step done for `userId` (idempotent). Does not check whether the
 * step may be marked by hand; callers decide that (see MANUALLY_MARKABLE).
 */
export async function markStepDone(userId: string, key: GetReadyStepKey): Promise<GetReadyWrite> {
  try {
    const before = await readGetReadySteps(userId);
    if (!before.ok) return before;
    const wasComplete = computeGetReady(before.keys).complete;
    const write = await upsertKeys(userId, [key]);
    if (!write.ok) return write;
    return await finish(userId, wasComplete);
  } catch (e) {
    console.error("[cc-get-ready] mark failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/**
 * Ticks or unticks one checklist sub-item. Ticking the last one marks the
 * step done; unticking one makes the step not done again (the journey stamp,
 * once written, stays).
 */
export async function setSubItem(
  userId: string,
  stepKey: GetReadyStepKey,
  subKey: string,
  checked: boolean
): Promise<GetReadyWrite> {
  if (getStepDef(stepKey).autoComplete !== "checklist" || !isSubItemOf(stepKey, subKey)) {
    return { ok: false, reason: "error" };
  }
  try {
    const before = await readGetReadySteps(userId);
    if (!before.ok) return before;
    const wasComplete = computeGetReady(before.keys).complete;
    const tick = subItemKey(stepKey, subKey);

    if (checked) {
      const after = [...new Set([...before.keys, tick])];
      const keys = allSubItemsTicked(stepKey, after) ? [tick, stepKey] : [tick];
      const write = await upsertKeys(userId, keys);
      if (!write.ok) return write;
    } else {
      const write = await deleteKeys(userId, [tick, stepKey]);
      if (!write.ok) return write;
    }
    return await finish(userId, wasComplete);
  } catch (e) {
    console.error("[cc-get-ready] tick failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
