import { z } from "zod";

import { canUse, serverWritesReady, setCadCode } from "@/lib/credits/server";
import { classifyCadRequest } from "@/lib/credits/classify";
import { CAD_SCHEMA, CAD_SYSTEM, cadPrompt } from "@/lib/cad/prompt";
import { cleanScad, validateScad } from "@/lib/cad/validate";
import { validatedCall } from "@/lib/prototyping/ai-call";
import { cloudConfigured } from "@/lib/cad/cloud";
import { logCloudFallback, runCloudCad } from "@/lib/cad/cloud-flow";
import { resolveCadEngine } from "@/lib/cad/engine";
import { getCadEngineSetting, loadProjectBoards } from "@/lib/cad/engine-server";
import { asLocale } from "@/lib/locale";
import { isMissingFunction } from "@/lib/supabase/errors";
import { requireUser } from "@/lib/auth/guards";
import { jsonError, jsonOk } from "@/lib/http";

// Mechanical › 3D model (CAD): Gemini writes ONE OpenSCAD file; the browser
// renders it (lib/cad/render.ts) and only then calls cad_deliver, which is
// where the credit is spent (migration 0043). This route never charges:
//   canUse("cad") → cad_begin (pending row, re-checks the rules) → model call,
//   validated statically with one retry → cad_set_code_for, or cad_fail.
// The code is stored by the SERVER (setCadCode: cad_set_code_for on the
// service client with the verified user id, 0102 / audit G-C1); without a
// service key the route answers 503 {error: "unavailable"} before cad_begin
// and before any model call.
// parentId = refine that version (request = the change), or with repair =
// rebuild it after the browser's OpenSCAD failed (request = its error output).
// Before 0043 runs, cad_begin is missing and the route answers
// needs_migration, so the card keeps its stub behaviour.
//
// store_settings.cad_engine (0067) can send a caller to the CLOUD engine instead
// (lib/cad/cloud-flow.ts): Gemini writes CadQuery, the Cloud Run worker builds
// STEP + STL + a preview, and the server delivers (spends) through the same
// cad_deliver. Worker down twice = this browser path, flagged {fallback: true}.

export const dynamic = "force-dynamic";
// The cloud path can take two model calls and up to four worker calls (60 s each).
export const maxDuration = 300;

const Body = z.object({
  projectId: z.string().uuid(),
  request: z.string().trim().min(1).max(4000),
  parentId: z.string().uuid().nullish(),
  repair: z.boolean().optional(),
  locale: z.string().optional(),
});

const Answer = z.object({
  scad: z.string(),
  summary: z.string().trim().max(600).catch(""),
  dimensions: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullish().catch(null),
});
type CadAnswer = { scad: string; summary: string; dimensions: { x: number; y: number; z: number } | null };

type RpcError = { code?: string; message?: string } | null;
const missing = (e: RpcError) =>
  !!e && (isMissingFunction(e) || /could not find the function/i.test(e.message ?? ""));

const STATUS: Record<string, number> = { sign_in: 401, no_credits: 402, not_found: 404, too_many_failed: 429 };

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { user, supabase } = auth;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("bad_request", 400);
  const { projectId, parentId, repair } = parsed.data;
  const locale = asLocale(parsed.data.locale);

  const access = await canUse(supabase, "cad", projectId);
  if (!access.allowed) {
    const reason = access.reason ?? "not_ready";
    return jsonError(reason, STATUS[reason] ?? 503);
  }
  // No service key → the code could not be stored: refuse before any model call.
  if (!serverWritesReady()) return jsonError("unavailable", 503);

  // The version being refined or repaired: the caller's own row (RLS).
  let previous: { scad: string; request: string } | null = null;
  if (parentId) {
    const { data, error } = await supabase
      .from("cad_generations")
      .select("scad, request")
      .eq("id", parentId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) return jsonError("needs_migration", 501);
    if (!data?.scad) return jsonError("not_found", 404);
    previous = { scad: data.scad, request: data.request };
  }
  if (repair && !previous) return jsonError("bad_request", 400);

  // A repair keeps the version's own request as its label; the error output only goes to the model.
  const asked = repair && previous ? previous.request : parsed.data.request;
  const { tier } = classifyCadRequest(asked);

  // Engine switch (store_settings.cad_engine, 0067). A repair is the browser
  // path's own retry after its OpenSCAD failed, so it always stays there.
  const setting = await getCadEngineSetting();
  let engine = repair ? "browser" : resolveCadEngine(setting.mode, access.role === "admin");
  if (engine === "cloud" && !cloudConfigured()) {
    await logCloudFallback(supabase, projectId, "not_configured", user.id);
    engine = "browser";
  }
  let fallback = false;
  if (engine === "cloud") {
    // A new model sets the project's tier (0042), as on the browser path.
    if (!parentId) await supabase.rpc("set_cad_request", { p_project: projectId, p_tier: tier });
    const cloud = await runCloudCad({
      supabase,
      userId: user.id,
      projectId,
      asked,
      request: parsed.data.request,
      tier,
      parentId: parentId ?? null,
      previous: previous ? { code: previous.scad, request: previous.request } : null,
      locale,
      minWallMm: setting.minWallMm,
      boards: await loadProjectBoards(supabase, projectId),
      // Keyless Google auth reads the Vercel OIDC token from the platform's
      // request context / env inside lib/cad/cloud.ts, never from this request (AI-04).
    });
    if (cloud.kind === "delivered") return jsonOk(cloud.body);
    if (cloud.kind === "error") return jsonError(cloud.error, cloud.status);
    // Worker down twice: tell the admin, then the existing browser path below.
    await logCloudFallback(supabase, projectId, cloud.reason, user.id);
    fallback = true;
  }

  const { data: id, error: beginError } = await supabase.rpc("cad_begin", {
    p_project: projectId,
    p_request: asked,
    p_tier: tier,
    p_parent: parentId ?? null,
  });
  if (beginError) {
    if (missing(beginError)) return jsonError("needs_migration", 501);
    const code = Object.keys(STATUS).find((c) => beginError.message?.includes(c));
    if (!code) console.error("[cad] cad_begin failed:", beginError.message);
    return jsonError(code ?? "failed", code ? STATUS[code] : 500);
  }
  const generationId = id as string;
  // A new model sets the project's tier (0042); a failure here changes nothing else.
  if (!parentId) await supabase.rpc("set_cad_request", { p_project: projectId, p_tier: tier });

  const result = await validatedCall<CadAnswer>({
    userId: user.id,
    supabase,
    projectId,
    feature: "cad",
    system: CAD_SYSTEM,
    prompt: cadPrompt({
      request: parsed.data.request,
      locale,
      previous,
      buildError: repair ? parsed.data.request : null,
    }),
    schema: CAD_SCHEMA,
    validate: (raw) => {
      const a = Answer.safeParse(raw);
      if (!a.success) return { value: null, errors: ["the answer must be {scad, summary, dimensions}"] };
      const scad = cleanScad(a.data.scad);
      const errors = validateScad(scad);
      return errors.length
        ? { value: null, errors }
        : { value: { scad, summary: a.data.summary, dimensions: a.data.dimensions ?? null }, errors: [] };
    },
  });

  if (!result.ok) {
    await supabase.rpc("cad_fail", {
      p_id: generationId,
      p_error: `${result.error}${result.problems.length ? `: ${result.problems.join("; ")}` : ""}`,
    });
    const status = result.error === "paused" || result.error === "rate_limited" ? 429 : result.error === "invalid" ? 502 : 503;
    return Response.json({ error: result.error }, { status });
  }

  const stored = await setCadCode(supabase, user.id, generationId, result.value.scad, result.model);
  if (!stored.ok) {
    console.error("[cad] cad_set_code_for failed:", stored.message);
    await supabase.rpc("cad_fail", { p_id: generationId, p_error: `not saved: ${stored.message}` });
    return stored.error === "unavailable" ? jsonError("unavailable", 503) : jsonError("failed", 500);
  }

  return Response.json({
    id: generationId,
    engine: "browser",
    fallback,
    scad: result.value.scad,
    tier,
    summary: result.value.summary,
    dimensions: result.value.dimensions,
  });
}
