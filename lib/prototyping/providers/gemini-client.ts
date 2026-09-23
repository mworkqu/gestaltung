// One Gemini generateContent call returning JSON. Server-only — shared by the
// brief analysis (./gemini) and the electronics netlist (app/api/netlist).
// GEMINI_API_KEY never reaches the browser.
//
// Model: gemini-3.5-flash-lite (checked against the live model list
// 2026-09-22); GEMINI_MODEL overrides it without a code change.
//
// Google answers 503 ("high demand") per MODEL, sometimes for hours: on
// 2026-09-22 Flash-Lite was refusing while Flash answered normally. So a
// call retries its model twice, then tries GEMINI_FALLBACK_MODEL (also a
// free-tier model) before giving up. The model that answered is returned and
// recorded with the usage, so the owner can see which one was used.

import { ProviderError, type TokenUsage } from "./types";

export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
/** Used only when the first model is unavailable; "" turns the fallback off. */
export const GEMINI_FALLBACK_MODEL =
  process.env.GEMINI_FALLBACK_MODEL?.trim() ?? "gemini-3.5-flash";
const endpointFor = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const TIMEOUT_MS = 25_000;

/** raw = the parsed JSON; rawText = the provider's reply exactly as received. */
export type GeminiResult = { raw: unknown; rawText: string; usage?: TokenUsage; model: string; latencyMs: number };

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY?.trim());

/** Any failure throws ProviderError carrying whatever usage and latency are known. */
export async function callGemini(opts: {
  system: string;
  prompt: string;
  schema: object;
  temperature?: number;
  /** Long structured answers (parts lists, circuits) need more than the default. */
  timeoutMs?: number;
}): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new ProviderError("missing_key");
  const started = Date.now();
  let model = GEMINI_MODEL;
  const fail = (reason: ConstructorParameters<typeof ProviderError>[0], detail: string, usage?: TokenUsage, rawText?: string) =>
    Object.assign(new ProviderError(reason, detail), { usage, rawText, latencyMs: Date.now() - started, model });

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: opts.temperature ?? 0.2,
    },
  });

  // Two tries on the chosen model, then the fallback model. A 503 costs no
  // tokens, so riding out a burst spends nothing.
  const models = [GEMINI_MODEL, GEMINI_MODEL, ...(GEMINI_FALLBACK_MODEL ? [GEMINI_FALLBACK_MODEL] : [])];
  let res: Response | null = null;
  for (const [i, m] of models.entries()) {
    const last = i === models.length - 1;
    if (i) await new Promise((r) => setTimeout(r, 2000));
    model = m;
    let problem: string | null = null;
    try {
      res = await fetch(endpointFor(m), {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: request,
        signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
        cache: "no-store",
      });
      // An overloaded model answers 503 — or simply never answers.
      if (res.status === 503) problem = "503";
    } catch (e) {
      problem = e instanceof Error ? e.message : String(e);
      res = null;
    }
    if (!problem) break;
    if (last) throw fail("unavailable", problem);
    console.warn(`[gemini] ${m} did not answer (${problem}); trying ${models[i + 1]}`);
  }
  if (!res) throw fail("unavailable", "no response");

  if (res.status === 429) throw fail("rate_limited", "HTTP 429", undefined, await res.text().catch(() => ""));
  if (!res.ok) throw fail("unavailable", `HTTP ${res.status}`, undefined, await res.text().catch(() => ""));

  const bodyText = await res.text();
  const body = (() => {
    try {
      return JSON.parse(bodyText);
    } catch {
      return null;
    }
  })() as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  } | null;

  const usage = body?.usageMetadata
    ? {
        input: body.usageMetadata.promptTokenCount ?? 0,
        output: body.usageMetadata.candidatesTokenCount ?? 0,
        total: body.usageMetadata.totalTokenCount ?? 0,
      }
    : undefined;

  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  try {
    return { raw: JSON.parse(text), rawText: text, usage, model, latencyMs: Date.now() - started };
  } catch {
    // Still report what the failed call cost, and what it actually said.
    throw fail("malformed", "response was not JSON", usage, text || bodyText);
  }
}
