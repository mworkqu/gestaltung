"use server";

import { revalidatePath } from "next/cache";

import { getCcUser } from "@/lib/cad-champions/auth/server";
import { CC_LOCALES } from "@/lib/cad-champions/db/types";
import { answerQuestion, setQuestionPublic, type AnswerResult } from "@/lib/cad-champions/questions/server";
import { ccPath } from "@/lib/cad-champions/routes";

// Questions inbox actions. Staff only, checked on the server for every call.

export async function answerQuestionAction(input: { questionId: string; answer: string }): Promise<AnswerResult | { ok: false; error: "forbidden" }> {
  const cc = await getCcUser();
  if (!cc?.isStaff) return { ok: false, error: "forbidden" };
  const res = await answerQuestion({ questionId: String(input.questionId ?? ""), answer: String(input.answer ?? ""), actorId: cc.user.id });
  if (res.ok) for (const l of CC_LOCALES) revalidatePath(ccPath(l, "/admin/questions"));
  return res;
}

export async function setQuestionPublicAction(input: { questionId: string; isPublic: boolean }): Promise<{ ok: boolean; error?: string }> {
  const cc = await getCcUser();
  if (!cc?.isStaff) return { ok: false, error: "forbidden" };
  const res = await setQuestionPublic({ questionId: String(input.questionId ?? ""), isPublic: !!input.isPublic, actorId: cc.user.id });
  if (res.ok) for (const l of CC_LOCALES) revalidatePath(ccPath(l, "/admin/questions"));
  return res;
}
