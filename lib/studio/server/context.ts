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
import { isSuperAdmin } from "./product";

export const STUDIO_TEMPERATURE = 0.2;

export type StudioCtx<T> = {
  supabase: SupabaseClient;
  userId: string;
  /** A guest's anonymous session (P5-16 guest limits). */
  isAnonymous: boolean;
  body: T;
  project: { id: string; spec: Spec | null };
};

export async function studioRequest<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  /** owner: refuse (404) anyone but the project's owner or a super_admin — for
   *  routes that write with the service role (product routes, 0100 / DB-01):
   *  a class teacher can SEE a team project under RLS but must not change it. */
  opts: { consent: boolean; owner?: boolean },
): Promise<StudioCtx<z.output<S>> | Response> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const body = parsed.data as z.output<S> & { projectId: string };

  const { data: project, error } = await supabase.from("projects").select("id, spec, user_id").eq("id", body.projectId).maybeSingle();
  if (error) return Response.json({ error: "not_ready" }, { status: 409 });
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  const { user_id: ownerId, ...row } = project as { id: string; spec: Spec | null; user_id?: string | null };
  if (opts.owner && ownerId !== user.id && !(await isSuperAdmin(supabase, user.id)))
    return Response.json({ error: "not_found" }, { status: 404 });
  if (opts.consent && !hasAiConsent(row.spec)) return Response.json({ error: "consent" }, { status: 403 });

  return { supabase, userId: user.id, isAnonymous: user.is_anonymous === true, body, project: row };
}

export function studioCall(supabase: SupabaseClient, projectId: string, userId?: string): StudioCall {
  return (req) =>
    validatedCall({
      supabase,
      userId,
      projectId,
      feature: "studio",
      step: req.step,
      system: req.system,
      prompt: req.prompt,
      schema: req.schema,
      validate: req.validate,
      temperature: STUDIO_TEMPERATURE,
      timeoutMs: req.timeoutMs ?? 45_000,
      ...(req.images?.length ? { images: req.images } : {}),
      ...(req.model ? { model: req.model } : {}),
    });
}

export function logClamp(step: StudioStep, projectId: string, log: ClampLog, source: "model" | "default" | "rules", problems: string[] = []) {
  if (source === "default") console.warn(`[studio/${step}] ${projectId}: safe default used${problems.length ? ` — ${problems.join("; ")}` : ""}`);
  if (log.length) console.info(`[studio/${step}] ${projectId}: ${log.length} value(s) clamped`, JSON.stringify(log).slice(0, 2000));
}
