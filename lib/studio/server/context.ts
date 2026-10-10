// Design Studio route plumbing. Server-only.
//
//  * studioRequest(): session (guest sessions count) → body (zod) → project
//    under RLS → optional AI-consent check. Returns a Response on refusal.
//  * studioCall(): binds validatedCall to feature "studio", the step, low
//    temperature. Logging with feature "studio" fails the ai_usage /
//    analysis_runs check constraints until 0068 runs; both writes are
//    best-effort (they only warn), so the user's call is never affected.
//  * logClamp(): clamp changes go to the server console (admin), never to the
//    response body.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { validatedCall } from "@/lib/prototyping/ai-call";
import { hasAiConsent, type Spec } from "@/lib/prototyping/spec";
import type { ClampLog } from "../schema";
import type { StudioCall, StudioStep } from "../ai/types";

export const STUDIO_TEMPERATURE = 0.2;

export type StudioCtx<T> = {
  supabase: SupabaseClient;
  userId: string;
  body: T;
  project: { id: string; spec: Spec | null };
};

export async function studioRequest<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  opts: { consent: boolean },
): Promise<StudioCtx<z.output<S>> | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const body = parsed.data as z.output<S> & { projectId: string };

  const { data: project, error } = await supabase.from("projects").select("id, spec").eq("id", body.projectId).maybeSingle();
  if (error) return Response.json({ error: "not_ready" }, { status: 409 });
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  const row = project as { id: string; spec: Spec | null };
  if (opts.consent && !hasAiConsent(row.spec)) return Response.json({ error: "consent" }, { status: 403 });

  return { supabase, userId: user.id, body, project: row };
}

export function studioCall(supabase: SupabaseClient, projectId: string): StudioCall {
  return (req) =>
    validatedCall({
      supabase,
      projectId,
      feature: "studio",
      step: req.step,
      system: req.system,
      prompt: req.prompt,
      schema: req.schema,
      validate: req.validate,
      temperature: STUDIO_TEMPERATURE,
      timeoutMs: 45_000,
    });
}

export function logClamp(step: StudioStep, projectId: string, log: ClampLog, source: "model" | "default", problems: string[] = []) {
  if (source === "default") console.warn(`[studio/${step}] ${projectId}: safe default used${problems.length ? ` — ${problems.join("; ")}` : ""}`);
  if (log.length) console.info(`[studio/${step}] ${projectId}: ${log.length} value(s) clamped`, JSON.stringify(log).slice(0, 2000));
}
