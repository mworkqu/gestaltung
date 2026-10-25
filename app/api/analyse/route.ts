import { createClient } from "@/lib/supabase/server";
import type { AnalysisEvent, AnalysisRequest } from "@/lib/prototyping/analysis";
import { AnalysisRequestSchema } from "@/lib/prototyping/analysis-schema";
import { runAnalysis } from "@/lib/prototyping/analyse-run";
import { logUsage, quota } from "@/lib/ai/usage";
import { bomRate } from "@/lib/credits/server";
import { readTurnstileToken } from "@/lib/turnstile";
import { checkTurnstile } from "@/lib/turnstile-server";
import { configuredProviderName, loadProvider } from "@/lib/prototyping/providers";
import { readWithRules } from "@/lib/prototyping/providers/rules";
import { jsonError } from "@/lib/http";

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
//
// The sequencing lives in lib/prototyping/analyse-run.ts (runAnalysis); this
// route authenticates, checks the CAPTCHA and the body, and streams its events.
//
// An identical request is never sent twice. Each run records the fingerprint of
// what was asked (0099), so a second press on an unchanged brief is answered
// from the stored run: no provider call, nothing metered, nothing charged. The
// decision is made here rather than in the browser, so holding the button down
// cannot get past it.

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  // Only someone with a session (a guest's anonymous session counts) may spend
  // the provider quota — the same people who can own a project.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });

  // Cloudflare Turnstile for guests (P2-08; was TODO(turnstile) in 0042 /
  // lib/credits/server.ts). Switch off or a key missing → not checked, as
  // before. On → an anonymous session must send a fresh token in the
  // x-turnstile-token header (IdeaStage renders the widget for guests).
  if (user.is_anonymous) {
    const check = await checkTurnstile(request, readTurnstileToken(request.headers));
    if (!check.ok) return jsonError("captcha_failed", 403);
  }

  const parsed = AnalysisRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const req: AnalysisRequest = parsed.data;

  const encoder = new TextEncoder();
  const events = runAnalysis(
    {
      db: supabase,
      userId: user.id,
      providerName: configuredProviderName(),
      loadProvider,
      quotaPaused: async (provider) => (await quota(supabase, provider)).paused,
      creditAllowed: async () => (await bomRate(supabase, request)).allowed,
      logUsage: (row) => logUsage(supabase, row),
      readWithRules,
    },
    req,
  );
  const stream = new ReadableStream<Uint8Array>({
    // Drained eagerly (not on pull) so the run is metered and recorded even if
    // the client goes away mid-stream.
    async start(controller) {
      const send = (e: AnalysisEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // The client disconnected: keep going so the run is still recorded.
        }
      };
      for await (const e of events) send(e);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
