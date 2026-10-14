"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { getCcUser } from "@/lib/cad-champions/auth/server";
import { ccPath } from "@/lib/cad-champions/routes";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

// Results page actions. Both check the session server-side and only act on
// the signed-in student's own attempt.

const UUID = /^[0-9a-f-]{36}$/i;
const GRADE_QUERY_MAX = 2000;

export type AskResult = { ok: true } | { ok: false; error: "empty" | "too_long" | "signed_out" | "not_found" | "already" | "error" };

/** "Question this result": a grade_query row in cc_lesson_questions (shows in the admin inbox). */
export async function askGradeQuery(input: { attemptId: string; taskResultId: string; body: string; locale: string }): Promise<AskResult> {
  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > GRADE_QUERY_MAX) return { ok: false, error: "too_long" };
  if (!UUID.test(input.attemptId ?? "") || !UUID.test(input.taskResultId ?? "")) return { ok: false, error: "not_found" };
  const cc = await getCcUser();
  if (!cc) return { ok: false, error: "signed_out" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "error" };
  try {
    const { data: tr } = await service
      .from("cc_task_results")
      .select("id,attempt_id,user_id")
      .eq("id", input.taskResultId)
      .eq("attempt_id", input.attemptId)
      .maybeSingle<{ id: string; attempt_id: string; user_id: string }>();
    if (!tr || tr.user_id !== cc.user.id) return { ok: false, error: "not_found" };

    const { data: open } = await service
      .from("cc_lesson_questions")
      .select("id")
      .eq("kind", "grade_query")
      .eq("task_result_id", tr.id)
      .eq("status", "open")
      .limit(1);
    if (open && open.length > 0) return { ok: false, error: "already" };

    const locale = input.locale === "ar" ? "ar" : "en";
    // The student's own RLS client: the insert policy allows only an open,
    // private, unanswered question of their own.
    const supabase = await createClient();
    const { error } = await supabase.from("cc_lesson_questions").insert({
      user_id: cc.user.id,
      kind: "grade_query",
      attempt_id: tr.attempt_id,
      task_result_id: tr.id,
      body,
      locale,
    });
    if (error) {
      console.error("[cc-results] grade query failed:", error.code ?? error.message);
      return { ok: false, error: "error" };
    }
    revalidatePath(ccPath(locale, `/results/${input.attemptId}`));
    return { ok: true };
  } catch (e) {
    console.error("[cc-results] grade query failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}

export type ShareResult = { ok: true; enabled: boolean; token: string | null } | { ok: false; error: "signed_out" | "not_found" | "not_ready" | "error" };

/** Turns the public share link on (new token) or off (token cleared, old link dead). */
export async function setResultShare(input: { attemptId: string; enabled: boolean }): Promise<ShareResult> {
  if (!UUID.test(input.attemptId ?? "")) return { ok: false, error: "not_found" };
  const cc = await getCcUser();
  if (!cc) return { ok: false, error: "signed_out" };
  const service = createServiceClient();
  if (!service) return { ok: false, error: "error" };
  try {
    const { data: a } = await service
      .from("cc_attempts")
      .select("id,user_id,status,share_token")
      .eq("id", input.attemptId)
      .maybeSingle<{ id: string; user_id: string; status: string; share_token: string | null }>();
    if (!a || a.user_id !== cc.user.id) return { ok: false, error: "not_found" };
    if (input.enabled && a.status !== "provisional" && a.status !== "graded") return { ok: false, error: "not_ready" };

    const token = input.enabled ? (a.share_token ?? randomBytes(24).toString("base64url")) : null;
    const { error } = await service.from("cc_attempts").update({ share_enabled: input.enabled, share_token: token }).eq("id", a.id);
    if (error) {
      console.error("[cc-results] share toggle failed:", error.code ?? error.message);
      return { ok: false, error: "error" };
    }
    return { ok: true, enabled: input.enabled, token };
  } catch (e) {
    console.error("[cc-results] share toggle failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, error: "error" };
  }
}
