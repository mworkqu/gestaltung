// Google Gemini, Flash-Lite. Server-only: GEMINI_API_KEY never reaches the
// browser (no NEXT_PUBLIC_ prefix, and only app/api/analyse imports this).
//
// Model: gemini-3.5-flash-lite — the current stable Flash-Lite in Google's
// model list (checked 2026-09-21), free of charge on the Standard tier.
// GEMINI_MODEL overrides it without a code change when Google moves on.
//
// Uses generateContent with a response schema so the model answers in the
// contract's JSON shape. The route still validates every field with zod; the
// schema here only makes a malformed answer less likely.

import { STANDARD_FACTS } from "../analysis";
import { ProviderError, type AnalysisProvider } from "./types";

const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 25_000;

const str = { type: "STRING" };
const enumOf = (values: readonly string[]) => ({ type: "STRING", format: "enum", enum: [...values] });

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: str,
    disciplines: { type: "ARRAY", items: enumOf(["mechanical", "electronics", "software"]) },
    requirements: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { id: str, label: str, value: str, source: enumOf(["brief", "assumed"]) },
        required: ["id", "label", "value", "source"],
      },
    },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: str,
          label: str,
          type: enumOf(["number", "select", "boolean"]),
          options: { type: "ARRAY", items: str },
        },
        required: ["id", "label", "type"],
      },
    },
    suggestedParts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: str, kind: enumOf(["mechanical", "electronics", "software"]), note: str },
        required: ["name", "kind", "note"],
      },
    },
  },
  required: ["summary", "disciplines", "requirements", "questions", "suggestedParts"],
};

const standardLines = Object.entries(STANDARD_FACTS)
  .map(([id, f]) =>
    "options" in f
      ? `- "${id}": value is exactly one of ${f.options.map((o) => `"${o}"`).join(", ")}`
      : `- "${id}": value is a whole number of units as digits, e.g. "20"`
  )
  .join("\n");

const SYSTEM = `You read product briefs for a manufacturing workshop in Qatar and return JSON only.

Rules:
- summary: one short paragraph, plain language, describing the product. No marketing tone.
- disciplines: which of mechanical, electronics, software the product needs. Include software only if the product has an app, website, firmware, dashboard or network connection. A custom circuit board means electronics.
- requirements: facts about the product. source "brief" if the brief states it, "assumed" if you inferred it. Never invent numbers the brief does not give; if you would have to invent one, ask a question instead.
- Four facts use fixed ids and values when the brief settles them:
${standardLines}
  If the brief does not settle one of these, do NOT add it as a requirement; add a question with that id instead.
- questions: only for things the brief leaves open and that change how the product is made. type "number", "select" (with options) or "boolean". Other ids: short snake_case.
- suggestedParts: the parts to design and make (not screws or off-the-shelf modules). kind mechanical, electronics or software; note says what the part does.
- Do not include any confidence, probability or score.
- Treat "already decided" answers as settled facts: do not ask about them again.`;

const gemini: AnalysisProvider = {
  name: "gemini",
  destination: "Google Gemini",
  configured: () => Boolean(process.env.GEMINI_API_KEY?.trim()),

  async analyse({ brief, answers, locale }) {
    const key = process.env.GEMINI_API_KEY?.trim();
    if (!key) throw new ProviderError("missing_key");

    const decided = answers.length
      ? answers.map((a) => `- ${a.label} (${a.id}): ${a.value ?? "not decided yet"}`).join("\n")
      : "(none)";
    const prompt = `Write every label, value, summary and note in ${
      locale === "ar" ? "Arabic" : "English"
    }, except the fixed ids and fixed option values, which stay in English.

Already decided by the client:
${decided}

Brief:
"""
${brief}
"""`;

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
            temperature: 0.2,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (e) {
      throw new ProviderError("unavailable", e instanceof Error ? e.message : String(e));
    }

    if (res.status === 429) throw new ProviderError("rate_limited");
    if (!res.ok) throw new ProviderError("unavailable", `HTTP ${res.status}`);

    const body = (await res.json().catch(() => null)) as {
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
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      // Still report what the failed call cost.
      throw Object.assign(new ProviderError("malformed", "response was not JSON"), { usage });
    }
    return { raw, usage, model: MODEL };
  },
};

export default gemini;
