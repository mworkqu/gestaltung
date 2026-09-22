import { createClient } from "@/lib/supabase/server";
import {
  withStandardGaps,
  type Analysis,
  type AnalysisEvent,
  type AnalysisRequest,
  type FallbackReason,
} from "@/lib/prototyping/analysis";
import {
  AnalysisRequestSchema,
  AnalysisSchema,
  DisciplinesSchema,
  RequirementsSchema,
} from "@/lib/prototyping/analysis-schema";
import { logUsage, quota } from "@/lib/ai/usage";
import type { ProviderId } from "@/lib/ai/limits";
import { configuredProviderName, loadProvider } from "@/lib/prototyping/providers";
import { readWithRules } from "@/lib/prototyping/providers/rules";
import { ProviderError, type TokenUsage } from "@/lib/prototyping/providers/types";

// Brief analysis. The ONLY place a provider is called — never from the
// browser, so no provider key ever leaves the server.
//
// Responds with NDJSON, one AnalysisEvent per line, so the client can show
// real progress: each step is sent when that stage has actually finished
// (the brief parsed; the answer's disciplines validated; its requirements and
// questions validated). The last line is the result.
//
// Any failure of the configured provider — no key, 429, malformed JSON, a
// response that fails validation, a network error — falls back to the basic
// reader, and the result says so. Never a blank answer, never a silent
// downgrade. So does the daily guard (lib/ai): at the configured share of the
// free allowance the provider is not called at all ("paused").
//
// Every provider call is recorded in ai_usage (lib/ai/usage), and every run's
// raw reply beside its parsed result in analysis_runs (0024) — so a wrong
// answer can be traced to the model or to our parsing.

export const dynamic = "force-dynamic";

/** Providers the daily guard meters. Others (the basic reader) cost nothing. */
const METERED: Record<string, ProviderId> = { gemini: "gemini" };

export async function POST(request: Request) {
  // Only someone with a session (a guest's anonymous session counts) may spend
  // the provider quota — the same people who can own a project.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  const parsed = AnalysisRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const req: AnalysisRequest = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AnalysisEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      send({ type: "step", step: "reading" });

      const name = configuredProviderName();
      let analysis: Analysis | null = null;
      let fallback: FallbackReason | null = null;
      let usedProvider = name;

      const metered = METERED[name];
      let called = false;
      let model: string | undefined;
      let usage: TokenUsage | undefined;
      let latencyMs: number | undefined;
      let rawText: string | undefined;
      let rawJson: unknown;
      let errorText: string | null = null;
      try {
        const provider = await loadProvider(name);
        if (!provider) throw new ProviderError("unavailable", `unknown provider "${name}"`);
        if (!provider.configured()) throw new ProviderError("missing_key");
        if (metered && (await quota(supabase, metered)).paused) throw new ProviderError("paused");

        called = true;
        const result = await provider.analyse(req);
        ({ model, usage, latencyMs, rawText } = result);
        rawJson = result.raw;
        const raw = (result.raw ?? {}) as Record<string, unknown>;

        if (!DisciplinesSchema.safeParse(raw.disciplines).success)
          throw new ProviderError("malformed", "disciplines");
        send({ type: "step", step: "disciplines" });

        if (!RequirementsSchema.safeParse(raw).success)
          throw new ProviderError("malformed", "requirements/questions");
        send({ type: "step", step: "requirements" });

        // Unknown keys (a `confidence` the model added, say) are stripped here.
        const full = AnalysisSchema.safeParse(raw);
        if (!full.success) throw new ProviderError("malformed", "summary/suggestedParts");
        analysis = full.data;
      } catch (e) {
        fallback = e instanceof ProviderError ? e.reason : "unavailable";
        const err = e as { usage?: TokenUsage; latencyMs?: number; model?: string; rawText?: string };
        rawText ??= err.rawText;
        errorText = `${fallback}: ${e instanceof Error ? e.message : String(e)}`;
        usage ??= err.usage;
        latencyMs ??= err.latencyMs;
        model ??= err.model;
        console.warn(`[analyse] ${name} failed (${fallback}): ${e instanceof Error ? e.message : e}. Using the basic reader.`);
        usedProvider = "rules";
      }

      if (metered && (called || fallback === "paused")) {
        await logUsage(supabase, {
          provider: metered,
          model,
          projectId: req.projectId,
          feature: "analyse",
          promptTokens: usage?.input,
          completionTokens: usage?.output,
          totalTokens: usage?.total,
          latencyMs,
          outcome: fallback === "paused" ? "blocked" : fallback ? "error" : "ok",
          errorCode: fallback,
        });
      }

      try {
        if (!analysis) {
          analysis = await readWithRules(req);
          send({ type: "step", step: "disciplines" });
          send({ type: "step", step: "requirements" });
        }
        const final = withStandardGaps(analysis);
        if (req.projectId) {
          const { error: runErr } = await supabase.from("analysis_runs").insert({
            project_id: req.projectId,
            feature: "analyse",
            provider: called ? name : usedProvider,
            model: model ?? null,
            raw_text: rawText ?? null,
            raw_response: rawJson ?? null,
            parsed_response: final,
            outcome: usedProvider === name ? "ok" : "fallback",
            error: errorText,
          });
          if (runErr) console.warn(`[analyse] run not recorded (migration 0024?): ${runErr.message}`);
        }
        send({
          type: "result",
          analysis: final,
          provider: usedProvider,
          fallback: usedProvider === name ? null : fallback,
        });
      } catch (e) {
        console.error("[analyse] basic reader failed:", e);
        send({ type: "error" });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
