// One AI drawing check call: the PDF as a document block BEFORE the
// instructions, output forced through the submit_checklist tool, zod
// validation and one retry on invalid output. Only relative imports, so the
// sample script (scripts/cc-ai-check-sample.mjs) can load it with Node.
// Tested with a mock client in ai-check.test.ts.

import Anthropic from "@anthropic-ai/sdk";

import { AI_SYSTEM_PROMPT, AI_TOOL_NAME, buildUserPrompt, checklistTool, promptItemsFrom, validateAiOutput, type AiItemResult } from "./ai-schema";
import type { RubricItem } from "./rubric";

const MAX_TOKENS = 8000;

/** The part of the SDK we use (lets tests pass a mock). */
export interface MessagesClient {
  messages: { create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

export interface AiCheckInput {
  model: string;
  pdfBase64: string;
  items: readonly Pick<RubricItem, "id" | "text_en" | "required" | "ai_guidance">[];
  brief?: string | null;
  kind: "part" | "assembly";
}

export type AiCheckRun =
  | { ok: true; items: AiItemResult[]; tokensIn: number; tokensOut: number; attempts: number; raw: unknown[] }
  | { ok: false; reason: "invalid_output" | "timeout" | "api_error" | "refusal"; error: string; tokensIn: number; tokensOut: number; attempts: number; raw: unknown[] };

function usageOf(m: Anthropic.Message): { tin: number; tout: number } {
  const u = m.usage;
  return {
    tin: (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0),
    tout: u?.output_tokens ?? 0,
  };
}

/** One check: the model call, validation, and one retry on invalid output. Never throws. */
export async function runAiCheck(client: MessagesClient, input: AiCheckInput): Promise<AiCheckRun> {
  const ids = input.items.map((i) => i.id);
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: input.model,
    max_tokens: MAX_TOKENS,
    system: AI_SYSTEM_PROMPT,
    // Forced tool choice (any/tool) is rejected by current models: "auto" +
    // a strict tool + the instruction to call it once. No tool call = invalid.
    tools: [checklistTool(ids)],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: input.pdfBase64 } },
          { type: "text", text: buildUserPrompt({ items: promptItemsFrom(input.items), brief: input.brief, kind: input.kind }) },
        ],
      },
    ],
  };

  let tokensIn = 0;
  let tokensOut = 0;
  const raw: unknown[] = [];
  let lastError = "no tool call";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let msg: Anthropic.Message;
    try {
      msg = await client.messages.create(params);
    } catch (e) {
      const timeout = e instanceof Anthropic.APIConnectionTimeoutError;
      const error = e instanceof Anthropic.APIError ? `${e.status ?? ""} ${e.message}`.trim() : e instanceof Error ? e.message : "unknown";
      return { ok: false, reason: timeout ? "timeout" : "api_error", error: error.slice(0, 500), tokensIn, tokensOut, attempts: attempt, raw };
    }
    const u = usageOf(msg);
    tokensIn += u.tin;
    tokensOut += u.tout;
    raw.push({ stop_reason: msg.stop_reason, content: msg.content.filter((b) => b.type === "tool_use" || b.type === "text") });
    if (msg.stop_reason === "refusal") {
      return { ok: false, reason: "refusal", error: "the model declined the request", tokensIn, tokensOut, attempts: attempt, raw };
    }
    const call = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === AI_TOOL_NAME);
    if (!call) {
      lastError = msg.stop_reason === "max_tokens" ? "output cut off (max_tokens)" : "no tool call";
      continue;
    }
    const valid = validateAiOutput(call.input, ids);
    if (valid.ok) return { ok: true, items: valid.items, tokensIn, tokensOut, attempts: attempt, raw };
    lastError = valid.error;
  }
  return { ok: false, reason: "invalid_output", error: lastError.slice(0, 500), tokensIn, tokensOut, attempts: 2, raw };
}
