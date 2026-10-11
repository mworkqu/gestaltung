// Idea chat → ProductSpec. Pure orchestration around an injected StudioCall.
//
// The model asks at most MAX_QUESTIONS tap-able questions, then returns the
// spec. Once that many questions are in the history the call demands the spec
// ("Return the spec now"); a question in reply is rejected, so validatedCall's
// one retry is that second "return the spec now" request. Two failures → a
// safe default spec built from the user's own words. quantity is always 1.
//
// W3: every turn goes through the deterministic guards (spec-guards.ts):
//  * a vague idea gets ONE clarifying question with chips, without a model call;
//  * every spec (model, default, refinement) keeps the visitor's function words,
//    a matching power source and the placement the idea implies;
//  * `current` = the card already shown: the last user message is a change
//    request ("make it solar"); the model must return the updated spec, and the
//    fallback is the current card with the guards applied (never a blank one).
// This is the ONE place the spec call is made (W8 may wrap it with a cache).

import { clampSpec, type ClampLog, type ProductSpec } from "../schema";
import { guardSpec, vagueTurn } from "./spec-guards";
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
  /** The spec card already shown: the last user message refines it. */
  current?: ProductSpec | null;
}): Promise<Outcome<SpecTurn>> {
  const ctx = { idea: opts.idea, messages: opts.messages, locale: opts.locale };
  const current = opts.current ?? null;

  // A vague idea ("something with Arduino"): one short question with chips, no model call.
  if (!current) {
    const vague = vagueTurn(opts.idea, opts.messages, opts.locale);
    if (vague) return { ok: true, value: vague, source: "rules", clampLog: [], problems: [] };
  }

  const log: ClampLog = [];
  const forceSpec = Boolean(current) || questionsAsked(opts.messages) >= MAX_QUESTIONS;
  const r = await opts.call<SpecTurn>({
    step: "spec",
    system: SPEC_SYSTEM,
    prompt: specPrompt({ idea: opts.idea, messages: opts.messages, locale: opts.locale, forceSpec, current }),
    schema: SPEC_RESPONSE_SCHEMA,
    validate: (raw) => {
      // Only the accepted attempt's changes are kept.
      const attempt: ClampLog = [];
      const res = validateTurn(raw, { forceSpec, log: attempt });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  const guard = (spec: ProductSpec, into: ClampLog): SpecTurn => ({ kind: "spec", spec: guardSpec(spec, ctx, into).spec });
  if (r.ok) {
    const value = r.value.kind === "spec" ? guard(r.value.spec, log) : r.value;
    return { ok: true, value, source: "model", clampLog: log, problems: [] };
  }
  if (r.error !== "invalid") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  const fallback: ClampLog = [];
  const base = current ?? defaultSpec(opts.idea, opts.messages, fallback);
  return {
    ok: true,
    value: guard(base, fallback),
    source: "default",
    clampLog: fallback,
    problems: r.problems,
  };
}
