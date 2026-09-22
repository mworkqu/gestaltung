// Google Gemini, Flash-Lite. Server-only: GEMINI_API_KEY never reaches the
// browser (no NEXT_PUBLIC_ prefix, and only app/api/analyse imports this).
//
// The HTTP call, model id and token accounting live in ./gemini-client,
// shared with the netlist. Uses generateContent with a response schema so the model answers in the
// contract's JSON shape. The route still validates every field with zod; the
// schema here only makes a malformed answer less likely.

import { STANDARD_FACTS } from "../analysis";
import { callGemini, geminiConfigured } from "./gemini-client";
import type { AnalysisProvider } from "./types";

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
    bom: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: str,
          function: str,
          spec: str,
          quantity: { type: "INTEGER" },
          kind: enumOf(["electronics", "mechanical", "consumable"]),
          critical: { type: "BOOLEAN" },
        },
        required: ["id", "function", "spec", "quantity", "kind", "critical"],
      },
    },
  },
  required: ["summary", "disciplines", "requirements", "questions", "suggestedParts", "bom"],
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
- bom: the off-the-shelf things to BUY for one unit (modules, motors, sensors, batteries, fasteners, cables, adhesives) — not the parts to design. Per line: id (short snake_case), function (what it does, e.g. "steering servo", "main controller", "5V supply"), spec (the requirement it must meet, e.g. "standard size, 5V, >= 3 kg.cm"), quantity (whole number per unit), kind electronics, mechanical or consumable, critical (true if the product cannot work without it).
- In bom NEVER name a brand, manufacturer, model or part number, and never give a price, stock level or lead time. Describe the function and the spec only.
- Do not include any confidence, probability or score.
- Treat "already decided" answers as settled facts: do not ask about them again.`;

const gemini: AnalysisProvider = {
  name: "gemini",
  destination: "Google Gemini",
  configured: geminiConfigured,

  async analyse({ brief, answers, locale }) {
    const decided = answers.length
      ? answers.map((a) => `- ${a.label} (${a.id}): ${a.value ?? "not decided yet"}`).join("\n")
      : "(none)";
    const prompt = `Write every label, value, summary, note, function and spec in ${
      locale === "ar" ? "Arabic" : "English"
    }, except the fixed ids and fixed option values, which stay in English.

Already decided by the client:
${decided}

Brief:
"""
${brief}
"""`;
    const r = await callGemini({ system: SYSTEM, prompt, schema: RESPONSE_SCHEMA });
    return { raw: r.raw, usage: r.usage, model: r.model, latencyMs: r.latencyMs };
  },
};

export default gemini;
