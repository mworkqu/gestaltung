"use server";

import { headers } from "next/headers";

import { clientIp, createRateLimiter } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";

// "Was this helpful?" vote. The RPC is service-role only, so this server action
// is the single door: it validates the slug, rate-limits per IP (in memory, a
// brake not a quota) and calls cc_help_feedback. Public: no sign-in needed.

export type HelpFeedbackResult = { ok: true } | { ok: false; error: "invalid" | "rate" | "save" };

const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 });

export async function submitHelpFeedback(slug: string, helpful: boolean): Promise<HelpFeedbackResult> {
  if (typeof slug !== "string" || !/^[a-z0-9-]{1,120}$/.test(slug) || typeof helpful !== "boolean") {
    return { ok: false, error: "invalid" };
  }
  const ip = clientIp(await headers());
  if (!limiter.hit(`help-feedback:${ip}`).allowed) return { ok: false, error: "rate" };

  const service = createServiceClient();
  if (!service) return { ok: false, error: "save" };
  const { error } = await service.rpc("cc_help_feedback", { p_slug: slug, p_helpful: helpful });
  if (error) {
    console.error("[cc help] feedback failed", error.message);
    return { ok: false, error: "save" };
  }
  return { ok: true };
}
