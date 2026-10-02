import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { canUse } from "@/lib/credits/server";
import { classifyCadRequest } from "@/lib/credits/classify";
import { CAD_SCHEMA, CAD_SYSTEM, cadPrompt } from "@/lib/cad/prompt";
import { cleanScad, validateScad } from "@/lib/cad/validate";
import { validatedCall } from "@/lib/prototyping/ai-call";

// Mechanical › 3D model (CAD): Gemini writes ONE OpenSCAD file; the browser
// renders it (lib/cad/render.ts) and only then calls cad_deliver, which is
// where the credit is spent (migration 0043). This route never charges:
//   canUse("cad") → cad_begin (pending row, re-checks the rules) → model call,
//   validated statically with one retry → cad_set_code, or cad_fail.
// parentId = refine that version (request = the change), or with repair =
// rebuild it after the browser's OpenSCAD failed (request = its error output).
// Before 0043 runs, cad_begin is missing and the route answers
// needs_migration, so the card keeps its stub behaviour.

export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

const STATUS: Record<string, number> = { sign_in: 401, no_credits: 402, not_found: 404, too_many_failed: 429 };

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "sign_in" }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { projectId, parentId, repair } = parsed.data;
  const locale = parsed.data.locale === "ar" ? "ar" : "en";

  const access = await canUse(supabase, "cad", projectId);
  if (!access.allowed) {
    const reason = access.reason ?? "not_ready";
    return Response.json({ error: reason }, { status: STATUS[reason] ?? 503 });
  }

  // The version being refined or repaired: the caller's own row (RLS).
  let previous: { scad: string; request: string } | null = null;
  if (parentId) {
    const { data, error } = await supabase
      .from("cad_generations")
      .select("scad, request")
      .eq("id", parentId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (error) return Response.json({ error: "needs_migration" }, { status: 501 });
    if (!data?.scad) return Response.json({ error: "not_found" }, { status: 404 });
    previous = { scad: data.scad, request: data.request };
  }
  if (repair && !previous) return Response.json({ error: "bad_request" }, { status: 400 });

  // A repair keeps the version's own request as its label; the error output only goes to the model.
  const asked = repair && previous ? previous.request : parsed.data.request;
  const { tier } = classifyCadRequest(asked);

  const { data: id, error: beginError } = await supabase.rpc("cad_begin", {
    p_project: projectId,
    p_request: asked,
    p_tier: tier,
    p_parent: parentId ?? null,
  });
  if (beginError) {
    if (missing(beginError)) return Response.json({ error: "needs_migration" }, { status: 501 });
    const code = Object.keys(STATUS).find((c) => beginError.message?.includes(c));
    if (!code) console.error("[cad] cad_begin failed:", beginError.message);
    return Response.json({ error: code ?? "failed" }, { status: code ? STATUS[code] : 500 });
  }
  const generationId = id as string;
  // A new model sets the project's tier (0042); a failure here changes nothing else.
  if (!parentId) await supabase.rpc("set_cad_request", { p_project: projectId, p_tier: tier });

  const result = await validatedCall<CadAnswer>({
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

  const { error: codeError } = await supabase.rpc("cad_set_code", {
    p_id: generationId,
    p_scad: result.value.scad,
    p_model: result.model,
  });
  if (codeError) {
    console.error("[cad] cad_set_code failed:", codeError.message);
    await supabase.rpc("cad_fail", { p_id: generationId, p_error: `not saved: ${codeError.message}` });
    return Response.json({ error: "failed" }, { status: 500 });
  }

  return Response.json({
    id: generationId,
    scad: result.value.scad,
    tier,
    summary: result.value.summary,
    dimensions: result.value.dimensions,
  });
}
