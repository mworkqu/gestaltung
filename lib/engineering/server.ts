// Engineering jobs — server side (migration 0091). Server-only.
// Submitting goes through the service-role function so the token amount comes
// from lib/engineering/config.ts, never from the browser.

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { STEP_JOB, type JobKind } from "./config";

export type JobRow = {
  id: string;
  project_id: string | null;
  user_id: string;
  kind: JobKind;
  status: string;
  tokens: number;
  eta_at: string | null;
  note: string | null;
  result_path: string | null;
  result_name: string | null;
  returned_path: string | null;
  created_at: string;
  ready_at: string | null;
};

export type SubmitResult =
  | { ok: true; job: JobRow }
  | { ok: false; error: "not_found" | "no_tokens" | "already_open" | "not_configured" | "failed" };

/** Engineers level: queue the full STEP file for a project (charges STEP_JOB.tokens). */
export async function submitStepJob(
  supabase: SupabaseClient,
  user: { id: string; isAdmin: boolean },
  projectId: string,
  note: string,
): Promise<SubmitResult> {
  const service = createServiceClient();
  if (!service) return { ok: false, error: "not_configured" };
  // The snapshot is what the engineer works from: the Studio doc as it is now (RLS read as the user).
  const { data: project } = await supabase.from("projects").select("id, name, studio").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, error: "not_found" };
  const { data, error } = await service.rpc("engineering_job_submit", {
    p_user: user.id,
    p_project: projectId,
    p_kind: STEP_JOB.kind,
    p_tokens: STEP_JOB.tokens,
    p_snapshot: { name: project.name, studio: project.studio ?? null },
    p_note: note,
    p_eta_hours: STEP_JOB.etaHours.max,
    p_free: user.isAdmin,
    p_payment: null,
  });
  if (error) {
    const known = (["not_found", "no_tokens", "already_open"] as const).find((c) => error.message.includes(c));
    if (!known) console.error("[engineering] submit failed:", error.message);
    return { ok: false, error: known ?? (/could not find the function|PGRST202/i.test(error.message) ? "not_configured" : "failed") };
  }
  return { ok: true, job: data as JobRow };
}
