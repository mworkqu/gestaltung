import { sendBatchAction } from "@/app/[locale]/cad-champions/admin/operations/actions";
import type { Progress } from "@/lib/cad-champions/admin/announcements-server";

export type LoopOutcome =
  | { state: "done"; progress: Progress }
  | { state: "stopped"; progress: Progress | null }
  | { state: "error"; progress: Progress | null; error: string };

/**
 * Calls the batch action until nothing is pending (25 emails per call).
 * Safe to stop and resume: pending deliveries stay pending, and a repeated
 * email is blocked by the idempotency key. Stops early when a whole batch
 * fails because email is not set up (no sending key).
 */
export async function runSendLoop(id: string, onProgress: (p: Progress) => void, shouldStop: () => boolean, maxCalls = 2000): Promise<LoopOutcome> {
  let last: Progress | null = null;
  for (let i = 0; i < maxCalls; i++) {
    if (shouldStop()) return { state: "stopped", progress: last };
    const r = await sendBatchAction(id);
    if (!r.ok) return { state: "error", progress: last, error: r.error };
    last = r.data;
    onProgress(r.data);
    if (r.data.status !== "sending" || r.data.pending === 0) return { state: "done", progress: r.data };
    if (r.data.lastError === "no_resend_key") return { state: "error", progress: r.data, error: "no_resend_key" };
  }
  return { state: "stopped", progress: last };
}
