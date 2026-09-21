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
// downgrade.

export const dynamic = "force-dynamic";

function logUsage(provider: string, model: string | undefined, usage: TokenUsage | undefined) {
  // Server console only, so the owner can watch usage against the free tier.
  console.info(
    `[analyse] ${provider}${model ? ` (${model})` : ""} tokens: ${
      usage ? `in=${usage.input} out=${usage.output} total=${usage.total}` : "not reported"
    }`
  );
}

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

      try {
        const provider = await loadProvider(name);
        if (!provider) throw new ProviderError("unavailable", `unknown provider "${name}"`);
        if (!provider.configured()) throw new ProviderError("missing_key");

        const result = await provider.analyse(req);
        logUsage(provider.name, result.model, result.usage);
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
        const usage = (e as { usage?: TokenUsage }).usage;
        if (usage) logUsage(name, undefined, usage);
        console.warn(`[analyse] ${name} failed (${fallback}): ${e instanceof Error ? e.message : e}. Using the basic reader.`);
        usedProvider = "rules";
      }

      try {
        if (!analysis) {
          analysis = await readWithRules(req);
          send({ type: "step", step: "disciplines" });
          send({ type: "step", step: "requirements" });
        }
        send({
          type: "result",
          analysis: withStandardGaps(analysis),
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
