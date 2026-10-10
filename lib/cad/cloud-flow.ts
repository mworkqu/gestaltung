// The cloud CAD path of POST /api/cad — server-only.
//
// Same credit rules as the browser path, through the SAME 0043 functions:
//   cad_begin   opens a pending row (credit_can_use + the 24 h cap)
//   cad_set_code stores the code once the worker has actually run it
//   cad_deliver spends (spend_credit: 1 cad credit = 3 versions, admin free) —
//               called here, by the server, only after the files are saved
//   cad_fail    on any failure: nothing is spent
// So: charged only when the first result is delivered, failed builds never
// charge, versions count, and the cap counts exactly what it counts today.
//
// One automatic repair (a new row, parent = the failed one, like the browser
// repair) fed with the worker's error and failed checks. Only a model that
// built AND passed every check (min wall, fits the board) is delivered and
// charged; one that still fails after the repair is not delivered and not
// charged (error "checks" or "render"). When the worker is
// down twice in a row (timeout / unreachable / refused), the row is failed
// WITHOUT code (so it does not count against the cap), an ai_usage row
// (provider "cad-worker", error_code "fallback_browser:<reason>") is written
// for the admin, and the route falls back to the browser OpenSCAD path.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { CAD_BUCKET } from "@/lib/design/constants";
import { validatedCall } from "@/lib/prototyping/ai-call";
import { CADQUERY_SCHEMA, CADQUERY_SYSTEM, cadQueryPrompt } from "./prompt";
import { cleanScad, validateCadQuery } from "./validate";
import { buildWithRetry, cloudFailureCode, nextCloudStep, repairMessages, type BuildResult } from "./cloud";
import { cloudFilePaths, mustContainBox, type CloudManifest } from "./engine";
import type { Footprint } from "@/lib/prototyping/footprints";

const Answer = z.object({
  code: z.string(),
  summary: z.string().trim().max(600).catch(""),
  dimensions: z.object({ x: z.number(), y: z.number(), z: z.number() }).nullish().catch(null),
});
type CqAnswer = { code: string; summary: string; dimensions: { x: number; y: number; z: number } | null };

type Ctx = {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  /** What the version list shows (the request, or the original request of a repair). */
  asked: string;
  /** What the model is asked (the request or the change). */
  request: string;
  tier: string;
  parentId: string | null;
  previous: { code: string; request: string } | null;
  locale: "en" | "ar";
  minWallMm: number;
  boards: Footprint[];
};

export type CloudReply =
  | { kind: "fallback"; reason: string }
  | { kind: "error"; error: string; status: number }
  | {
      kind: "delivered";
      body: {
        id: string;
        engine: "cloud";
        code: string;
        tier: string;
        summary: string;
        dimensions: { x: number; y: number; z: number } | null;
        manifest: CloudManifest;
        files: ReturnType<typeof cloudFilePaths>;
      };
    };

const STATUS: Record<string, number> = { sign_in: 401, no_credits: 402, not_found: 404, too_many_failed: 429 };

const fail = (supabase: SupabaseClient, id: string, error: string) =>
  supabase.rpc("cad_fail", { p_id: id, p_error: error.slice(0, 500) }).then(
    () => undefined,
    () => undefined
  );

/** The admin's signal that the cloud worker was skipped: one ai_usage row (no new table). */
export async function logCloudFallback(supabase: SupabaseClient, projectId: string, reason: string) {
  console.warn(`[cad] cloud worker unavailable (${reason}); using the browser engine`);
  const { error } = await supabase.rpc("log_ai_usage", {
    p_provider: "cad-worker",
    p_model: null,
    p_project: projectId,
    p_feature: "cad",
    p_prompt_tokens: null,
    p_completion_tokens: null,
    p_total_tokens: null,
    p_audio_seconds: null,
    p_latency_ms: null,
    p_outcome: "error",
    p_error_code: `fallback_browser:${reason}`.slice(0, 60),
    p_remaining_requests: null,
    p_remaining_tokens: null,
  });
  if (error) console.warn(`[cad] fallback not recorded: ${error.message}`);
}

async function writeCode(ctx: Ctx, request: string, previous: Ctx["previous"], buildError: string | null) {
  return validatedCall<CqAnswer>({
    supabase: ctx.supabase,
    projectId: ctx.projectId,
    feature: "cad",
    system: CADQUERY_SYSTEM,
    prompt: cadQueryPrompt({
      request,
      locale: ctx.locale,
      minWallMm: ctx.minWallMm,
      mustContain: board(ctx),
      previous,
      buildError,
    }),
    schema: CADQUERY_SCHEMA,
    validate: (raw) => {
      const a = Answer.safeParse(raw);
      if (!a.success) return { value: null, errors: ["the answer must be {code, summary, dimensions}"] };
      const code = cleanScad(a.data.code);
      const errors = validateCadQuery(code);
      return errors.length
        ? { value: null, errors }
        : { value: { code, summary: a.data.summary, dimensions: a.data.dimensions ?? null }, errors: [] };
    },
  });
}

function board(ctx: Ctx) {
  const box = mustContainBox(ctx.boards);
  if (!box) return null;
  const main = [...ctx.boards].sort((a, b) => b.length_mm * b.width_mm - a.length_mm * a.width_mm)[0];
  return { label: main.label, ...box };
}

async function begin(ctx: Ctx, parentId: string | null): Promise<{ id: string } | { error: string; status: number }> {
  const { data, error } = await ctx.supabase.rpc("cad_begin", {
    p_project: ctx.projectId,
    p_request: ctx.asked,
    p_tier: ctx.tier,
    p_parent: parentId,
  });
  if (error) {
    const code = Object.keys(STATUS).find((c) => error.message?.includes(c));
    if (!code) console.error("[cad] cad_begin failed:", error.message);
    return { error: code ?? "failed", status: code ? STATUS[code] : 500 };
  }
  return { id: data as string };
}

async function setCode(ctx: Ctx, id: string, code: string, model: string | null): Promise<boolean> {
  const { error } = await ctx.supabase.rpc("cad_set_code", { p_id: id, p_scad: code, p_model: model });
  if (error) console.error("[cad] cad_set_code failed:", error.message);
  return !error;
}

/** Save the files, then deliver (spend). Files are removed again if delivery fails. */
async function deliver(
  ctx: Ctx,
  id: string,
  code: string,
  answer: CqAnswer,
  r: BuildResult
): Promise<CloudReply> {
  const files = cloudFilePaths(ctx.userId, ctx.projectId, id);
  const b = board(ctx);
  const manifest: CloudManifest = {
    engine: "cloud",
    bbox: r.bbox,
    volumeMm3: r.volumeMm3,
    checks: r.checks,
    log: r.log,
    minWallMm: ctx.minWallMm,
    board: b ? { label: b.label, box: { x: b.x, y: b.y, z: b.z } } : null,
  };
  const storage = ctx.supabase.storage.from(CAD_BUCKET);
  const uploads: [string, Buffer, string][] = [
    [files.step, Buffer.from(r.stepB64 ?? "", "base64"), "application/step"],
    [files.stl, Buffer.from(r.stlB64 ?? "", "base64"), "model/stl"],
    [files.svg, Buffer.from(r.previewSvg ?? "", "utf8"), "image/svg+xml"],
    [files.manifest, Buffer.from(JSON.stringify(manifest), "utf8"), "application/json"],
  ];
  const results = await Promise.all(
    uploads.map(([path, body, contentType]) => storage.upload(path, body, { contentType, upsert: true }))
  );
  const removeAll = () => storage.remove(Object.values(files)).then(() => undefined, () => undefined);
  if (results.some((u) => u.error)) {
    console.error("[cad] cloud files not saved:", results.find((u) => u.error)?.error?.message);
    await removeAll();
    await fail(ctx.supabase, id, "deliver: files not saved");
    return { kind: "error", error: "deliver", status: 500 };
  }

  const { error } = await ctx.supabase.rpc("cad_deliver", { p_id: id });
  if (error) {
    await removeAll();
    // Same as the browser path: the row stays pending and nothing is spent.
    const reason = (["sign_in", "no_credits"] as const).find((c) => error.message?.includes(c));
    if (!reason) console.error("[cad] cad_deliver failed:", error.message);
    return { kind: "error", error: reason ?? "deliver", status: reason ? STATUS[reason] : 500 };
  }
  return {
    kind: "delivered",
    body: { id, engine: "cloud", code, tier: ctx.tier, summary: answer.summary, dimensions: answer.dimensions, manifest, files },
  };
}

const modelError = (e: "paused" | "unavailable" | "rate_limited" | "invalid"): CloudReply => ({
  kind: "error",
  error: e,
  status: e === "paused" || e === "rate_limited" ? 429 : e === "invalid" ? 502 : 503,
});

export async function runCloudCad(ctx: Ctx): Promise<CloudReply> {
  const a = await begin(ctx, ctx.parentId);
  if ("error" in a) return { kind: "error", error: a.error, status: a.status };

  const first = await writeCode(ctx, ctx.request, ctx.previous, null);
  if (!first.ok) {
    await fail(ctx.supabase, a.id, `${first.error}${first.problems.length ? `: ${first.problems.join("; ")}` : ""}`);
    return modelError(first.error);
  }
  const code1 = first.value.code;
  const b1 = await buildWithRetry({ code: code1, minWallMm: ctx.minWallMm, mustContainBox: mustContainBox(ctx.boards) });
  if (b1.kind === "down") {
    // No code stored: our own outage never counts against the caller's cap.
    await fail(ctx.supabase, a.id, `cloud_down: ${b1.reason}`);
    return { kind: "fallback", reason: b1.reason };
  }
  if (!(await setCode(ctx, a.id, code1, first.model))) {
    await fail(ctx.supabase, a.id, "not saved");
    return { kind: "error", error: "failed", status: 500 };
  }

  const step1 = nextCloudStep(b1);
  if (step1.action === "deliver") return deliver(ctx, a.id, code1, first.value, b1.result);

  // ONE automatic repair, fed with the worker's own words (its error and every
  // failed check). A model that built but failed a check is NOT delivered: the
  // first row is failed (no charge) and only a clean repair is delivered.
  await fail(ctx.supabase, a.id, `build: ${repairMessages(b1.result)}`);

  const b = await begin(ctx, a.id);
  if ("error" in b) return { kind: "error", error: b.error === "failed" ? cloudFailureCode(b1) : b.error, status: b.status };
  const second = await writeCode(ctx, ctx.asked, { code: code1, request: ctx.asked }, repairMessages(b1.result));
  if (!second.ok) {
    await fail(ctx.supabase, b.id, `${second.error}: repair not written`);
    return { kind: "error", error: cloudFailureCode(b1), status: 502 };
  }
  let b2 = await buildWithRetry({ code: second.value.code, minWallMm: ctx.minWallMm, mustContainBox: mustContainBox(ctx.boards) });
  if (b2.kind === "result" && !(await setCode(ctx, b.id, second.value.code, second.model))) {
    b2 = { kind: "result", result: { ...b2.result, ok: false, error: "not saved" } };
  }

  const step2 = nextCloudStep(b1, b2);
  if (step2.action === "deliver" && b2.kind === "result") return deliver(ctx, b.id, second.value.code, second.value, b2.result);
  await fail(ctx.supabase, b.id, b2.kind === "down" ? `cloud_down: ${b2.reason}` : `build: ${repairMessages(b2.result)}`);
  if (step2.action === "fallback" && b2.kind === "down") return { kind: "fallback", reason: b2.reason };
  return { kind: "error", error: cloudFailureCode(b2), status: 502 };
}
