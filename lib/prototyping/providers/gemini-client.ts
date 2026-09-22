// One Gemini generateContent call returning JSON. Server-only — shared by the
// brief analysis (./gemini) and the electronics netlist (app/api/netlist).
// GEMINI_API_KEY never reaches the browser.
//
// Model: gemini-3.5-flash-lite (checked against the live model list
// 2026-09-22); GEMINI_MODEL overrides it without a code change.

import { ProviderError, type TokenUsage } from "./types";

export const GEMINI_MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
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
}): Promise<GeminiResult> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) throw new ProviderError("missing_key");
  const started = Date.now();
  const fail = (reason: ConstructorParameters<typeof ProviderError>[0], detail: string, usage?: TokenUsage, rawText?: string) =>
    Object.assign(new ProviderError(reason, detail), { usage, rawText, latencyMs: Date.now() - started, model: GEMINI_MODEL });

  const request = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: opts.temperature ?? 0.2,
    },
  });

  // Google answers 503 ("high demand") in short bursts; two quick retries
  // ride most of them out. A 503 costs no tokens, so this spends nothing.
  let res!: Response;
  for (const wait of [0, 2000, 5000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: request,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      throw fail("unavailable", e instanceof Error ? e.message : String(e));
    }
    if (res.status !== 503) break;
  }

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
    return { raw: JSON.parse(text), rawText: text, usage, model: GEMINI_MODEL, latencyMs: Date.now() - started };
  } catch {
    // Still report what the failed call cost, and what it actually said.
    throw fail("malformed", "response was not JSON", usage, text || bodyText);
  }
}
