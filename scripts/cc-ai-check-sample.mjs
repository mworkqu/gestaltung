#!/usr/bin/env node
// CAD Champions: run the AI drawing check on one local PDF and print the
// structured result. For a real end-to-end check of Prompt 8 with your own
// Anthropic key. NO database reads or writes, nothing is stored.
//
// Usage (from the repo root, Node 24+):
//   ANTHROPIC_API_KEY=sk-ant-... node scripts/cc-ai-check-sample.mjs path/to/drawing.pdf [part|assembly] ["task brief"]
//   (PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."; node scripts/cc-ai-check-sample.mjs drawing.pdf)
// Optional: ANTHROPIC_MODEL (default claude-sonnet-5-5).
//
// It uses the same prompt, tool, validation, limits and scoring as the site
// (lib/cad-champions/drawing/*.ts, loaded through Node's TypeScript type
// stripping) with the default rubric from rubric.ts. Each run costs a few
// cents; the estimated cost is printed at the end.

import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";

// The lib files import siblings without an extension ("./ai-schema"): add ".ts".
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (e) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});

const [, , pdfPath, kindArg, brief] = process.argv;
if (!pdfPath) {
  console.error("Usage: node scripts/cc-ai-check-sample.mjs <drawing.pdf> [part|assembly] [\"task brief\"]");
  process.exit(2);
}
const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").trim();
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY first (it is never stored).");
  process.exit(2);
}
const kind = kindArg === "assembly" ? "assembly" : "part";
const model = (process.env.ANTHROPIC_MODEL ?? "").trim() || "claude-sonnet-5-5";

const lib = (f) => pathToFileURL(resolvePath("lib/cad-champions/drawing", f)).href;
const { default: Anthropic } = await import("@anthropic-ai/sdk");
const { defaultRubric } = await import(lib("rubric.ts"));
const { pdfLimitProblem, countPdfPages } = await import(lib("pdf.ts"));
const { runAiCheck } = await import(lib("ai-run.ts"));
const { scoreAiItems, summaryText } = await import(lib("ai-schema.ts"));
const { estimateCostUsd } = await import(lib("ai-prices.ts"));

const bytes = new Uint8Array(readFileSync(pdfPath));
const problem = pdfLimitProblem(bytes);
console.log(`File: ${pdfPath} (${(bytes.length / 1024).toFixed(0)} KB, pages: ${countPdfPages(bytes) ?? "unknown"})`);
if (problem) {
  console.log(`Skipped: ${problem} -> on the site this drawing goes straight to the trainer.`);
  process.exit(0);
}

const rubric = defaultRubric(kind);
const aiItems = rubric.items.filter((i) => i.type === "measurement" && i.check_type === "ai");
const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
const started = Date.now();
const run = await runAiCheck(client, { model, pdfBase64: Buffer.from(bytes).toString("base64"), items: aiItems, brief: brief ?? null, kind });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (!run.ok) {
  console.log(`AI check failed (${run.reason}): ${run.error}`);
  console.log("On the site this drawing goes to manual review with that reason.");
} else {
  const scored = scoreAiItems(
    aiItems.map((i) => ({ aspectId: i.id, itemId: i.id, maxPoints: i.points })),
    run.items
  );
  console.log(`\nModel: ${model} · ${seconds} s · attempts: ${run.attempts}`);
  console.log(`Summary: ${summaryText(scored.summary)} · flagged for the trainer: ${scored.summary.flagged}`);
  console.log(`AI score (confident passes): ${scored.aiScore} of ${aiItems.reduce((s, i) => s + i.points, 0)} AI points\n`);
  for (const it of run.items) {
    console.log(`- ${it.id.padEnd(22)} ${it.status.padEnd(8)} ${(it.confidence * 100).toFixed(0).padStart(3)}%  p${it.page}  ${it.evidence}`);
    console.log(`  EN: ${it.feedback_en}`);
    console.log(`  AR: ${it.feedback_ar}`);
  }
  console.log("\nFull JSON:");
  console.log(JSON.stringify({ items: run.items, summary: scored.summary, ai_score: scored.aiScore }, null, 2));
}
console.log(`\nTokens: in ${run.tokensIn}, out ${run.tokensOut} · estimated cost USD ${estimateCostUsd(model, run.tokensIn, run.tokensOut)}`);
