// Idea chat → ProductSpec. Pure orchestration around an injected StudioCall.
//
// The model asks at most MAX_QUESTIONS tap-able questions, then returns the
// spec. Once that many questions are in the history the call demands the spec
// ("Return the spec now"); a question in reply is rejected, so validatedCall's
// one retry is that second "return the spec now" request. Two failures → a
// safe default spec built from the user's own words. quantity is always 1.

import { clampSpec, type ClampLog, type ProductSpec } from "../schema";
import {
  CHOICE_MAX, MAX_QUESTIONS, QUESTION_MAX, SPEC_RESPONSE_SCHEMA, SPEC_SYSTEM, specPrompt, type ChatMessage,
} from "./prompts";
import { cut, isObj, type Outcome, type StudioCall } from "./types";

export type SpecTurn =
  | { kind: "question"; question: string; choices: string[] }
  | { kind: "spec"; spec: ProductSpec };

export const MAX_MESSAGES = 16;
export const MESSAGE_MAX = 1500;
export const IDEA_MAX = 2000;

/** Same limits as /api/brief-chat: last 16 messages, 1,500 characters each. */
export function cleanMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m): m is Record<string, unknown> => isObj(m) && (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const msg: ChatMessage = { role: m.role as ChatMessage["role"], text: String(m.text).slice(0, MESSAGE_MAX) };
      if (Array.isArray(m.choices)) msg.choices = m.choices.filter((c): c is string => typeof c === "string").slice(0, 4).map((c) => cut(c, CHOICE_MAX));
      return msg;
    });
}

export const questionsAsked = (messages: ChatMessage[]) => messages.filter((m) => m.role === "assistant").length;

/** The fallback when the model fails twice: the user's own words, everything else default. */
export function defaultSpec(idea: string, messages: ChatMessage[], log: ClampLog): ProductSpec {
  const first = idea.trim() || messages.find((m) => m.role === "user")?.text.trim() || "";
  const words = first.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  return clampSpec({ name: cut(words, 40), oneLine: cut(first, 120), quantity: 1 }, log);
}

export function validateTurn(raw: unknown, opts: { forceSpec: boolean; log: ClampLog }): { value: SpecTurn | null; errors: string[] } {
  if (!isObj(raw)) return { value: null, errors: ["the answer must be a JSON object: {question, choices} or {spec}"] };
  if (isObj(raw.spec)) {
    const spec = isObj(raw.spec) ? raw.spec : {};
    const errors: string[] = [];
    if (typeof spec.name !== "string" || !spec.name.trim()) errors.push("spec.name is required");
    if (errors.length) return { value: null, errors };
    const turnLog: ClampLog = [];
    const value: SpecTurn = { kind: "spec", spec: clampSpec(spec, turnLog) };
    opts.log.push(...turnLog);
    return { value, errors: [] };
  }
  if (opts.forceSpec) return { value: null, errors: [`${MAX_QUESTIONS} questions were already asked: return the spec now, not a question`] };
  const question = cut(raw.question, QUESTION_MAX);
  if (!question) return { value: null, errors: ["return either a question with 2–4 choices, or the spec"] };
  const seen = new Set<string>();
  const choices = (Array.isArray(raw.choices) ? raw.choices : [])
    .map((c) => cut(c, CHOICE_MAX))
    .filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()))
    .slice(0, 4);
  if (choices.length < 2) return { value: null, errors: ["offer 2–4 short choices with the question"] };
  if (typeof raw.question === "string" && raw.question.trim().length > QUESTION_MAX)
    opts.log.push({ path: "question", from: raw.question, to: question });
  return { value: { kind: "question", question, choices }, errors: [] };
}

export async function runSpecChat(opts: {
  call: StudioCall;
  idea: string;
  messages: ChatMessage[];
  locale: "en" | "ar";
}): Promise<Outcome<SpecTurn>> {
  const log: ClampLog = [];
  const forceSpec = questionsAsked(opts.messages) >= MAX_QUESTIONS;
  const r = await opts.call<SpecTurn>({
    step: "spec",
    system: SPEC_SYSTEM,
    prompt: specPrompt({ idea: opts.idea, messages: opts.messages, locale: opts.locale, forceSpec }),
    schema: SPEC_RESPONSE_SCHEMA,
    validate: (raw) => {
      // Only the accepted attempt's changes are kept.
      const attempt: ClampLog = [];
      const res = validateTurn(raw, { forceSpec, log: attempt });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  if (r.ok) return { ok: true, value: r.value, source: "model", clampLog: log, problems: [] };
  if (r.error !== "invalid") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  const fallback: ClampLog = [];
  return {
    ok: true,
    value: { kind: "spec", spec: defaultSpec(opts.idea, opts.messages, fallback) },
    source: "default",
    clampLog: fallback,
    problems: r.problems,
  };
}
