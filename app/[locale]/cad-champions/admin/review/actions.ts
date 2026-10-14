"use server";

import { revalidatePath } from "next/cache";

import { getCcUser } from "@/lib/cad-champions/auth/server";
import { finalizeReview, type FinalizeResult } from "@/lib/cad-champions/drawing/finalize";
import type { Decision } from "@/lib/cad-champions/drawing/review";
import { translateComment, type TranslateResult } from "@/lib/cad-champions/drawing/translate";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { ccPath } from "@/lib/cad-champions/routes";

// Trainer review actions. Staff only (instructor or admin), checked here on
// the server for every call.

export async function finalizeReviewAction(input: {
  taskResultId: string;
  decisions: Decision[];
  commentEn: string;
  commentAr: string;
  machineTranslated: "en" | "ar" | null;
}): Promise<FinalizeResult | { ok: false; error: "forbidden" }> {
  const cc = await getCcUser();
  if (!cc?.isStaff) return { ok: false, error: "forbidden" };
  const decisions = Array.isArray(input.decisions)
    ? input.decisions.slice(0, 100).map((d) => ({
        aspectId: String(d?.aspectId ?? ""),
        passed: typeof d?.passed === "boolean" ? d.passed : null,
        score: typeof d?.score === "number" ? d.score : null,
      }))
    : [];
  const res = await finalizeReview({
    taskResultId: String(input.taskResultId ?? ""),
    actorId: cc.user.id,
    decisions,
    commentEn: String(input.commentEn ?? ""),
    commentAr: String(input.commentAr ?? ""),
    machineTranslated: input.machineTranslated === "en" || input.machineTranslated === "ar" ? input.machineTranslated : null,
  });
  if (res.ok) {
    for (const l of CC_LOCALES) {
      revalidatePath(ccPath(l, "/admin/review"));
      revalidatePath(ccPath(l, `/results/${res.attemptId}`));
    }
  }
  return res;
}

export async function translateCommentAction(input: { taskResultId: string; text: string; to: "en" | "ar" }): Promise<TranslateResult | { ok: false; reason: "forbidden" }> {
  const cc = await getCcUser();
  if (!cc?.isStaff) return { ok: false, reason: "forbidden" };
  return translateComment({ text: String(input.text ?? ""), to: input.to === "ar" ? "ar" : "en", taskResultId: /^[0-9a-f-]{36}$/i.test(input.taskResultId ?? "") ? input.taskResultId : null });
}
