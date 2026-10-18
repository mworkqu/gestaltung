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
//  * `current` = the card already shown: the last user message may be a change
//    request ("make it solar") or anything else (see Part A below); the fallback
//    is the current card with the guards applied (never a blank one).
// This is the ONE place the spec call is made. W8: an optional `cache` (the route passes
// specCache) returns the same answer for the same chat + card without calling the model.
//
// Part A: once the card exists the chat answers like a person. A refine turn is
// {reply, changed, spec?}: `reply` always (1-2 sentences, page language), `spec`
// only when the message asked for a change (a spec equal to the card is dropped),
// `changed` = short labels of what changed. Greetings, thanks, insults, emoji and
// empty messages get a canned reply from chatGuardTurn() without a model call. The
// first card may carry a reply too (scope honesty: "a real UR10 is 1.3 m...").

import { ACTUATOR_KINDS, clampSpec, type ClampLog, type ProductSpec } from "../schema";
import { chatGuardTurn, guardSpec, vagueTurn } from "./spec-guards";
import { actuatorCountLabel, actuatorTotals, capStrongServos, setActuatorCount } from "../actuators";
import { outcomeCached, specKey, type AiCache } from "./cache";
import {
  CHANGED_ITEMS, CHANGED_MAX, CHOICE_MAX, MAX_QUESTIONS, QUESTION_MAX, REFINE_RESPONSE_SCHEMA, REPLY_MAX, SPEC_RESPONSE_SCHEMA, SPEC_SYSTEM,
  specPrompt,
  type ChatMessage,
} from "./prompts";
import { cut, isObj, type Outcome, type StudioCall } from "./types";

export type SpecTurn =
  | { kind: "question"; question: string; choices: string[] }
  /** The first card (before it existed); `reply` only when there is something to say (scope honesty). */
  | { kind: "spec"; spec: ProductSpec; reply?: string }
  /** Part A: a turn once the card exists. No `spec` = the card is untouched. */
  | { kind: "reply"; reply: string; spec?: ProductSpec; changed: string[]; diff?: string[] };

/** How a turn is asked: a question may come back, the spec is due, or the card exists (refine). */
export type TurnMode = "ask" | "force" | "refine";

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

/** The model may never claim to be human or name the provider: such a reply becomes our own identity line. */
const LEAKY =
  /\b(?:gemini|google|bard|deepmind|openai|chat ?gpt|gpt-?\d|anthropic|claude|llama|meta ai|large language model|i am (?:a )?human|i'm (?:a )?human)\b|جيميني|جيمناي|جوجل|غوغل|قوقل|أنا إنسان|انا انسان/i;

export const IDENTITY_REPLY: Record<"en" | "ar", string> = {
  en: "I'm Gestaltung's design assistant — I help turn your idea into parts, wiring and a case. What would you like to change?",
  ar: "أنا مساعد التصميم في جِشتالتُونج — أساعدك على تحويل فكرتك إلى قطع وتوصيلات وعلبة. ماذا تريد أن تغيّر؟",
};

/** The reply when the model fails twice on a refine turn. */
export const FALLBACK_REPLY: Record<"en" | "ar", { same: string; updated: string }> = {
  en: { same: "Sorry, I didn't catch that. Tell me what to change on the card.", updated: "I updated your card." },
  ar: { same: "عذراً، لم أفهم ذلك. أخبرني ماذا أغيّر في البطاقة.", updated: "حدّثتُ بطاقتك." },
};

function cleanReply(v: unknown, locale: "en" | "ar", log: ClampLog): string {
  const reply = cut(v, REPLY_MAX);
  if (!reply) return "";
  if (typeof v === "string" && v.trim().length > REPLY_MAX) log.push({ path: "reply", from: v, to: reply });
  if (LEAKY.test(reply)) {
    log.push({ path: "reply", from: reply, to: "identity" });
    return IDENTITY_REPLY[locale];
  }
  return reply;
}

function cleanChanged(v: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(v) ? v : [])
    .map((c) => cut(c, CHANGED_MAX))
    .filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()))
    .slice(0, CHANGED_ITEMS);
}

/** Same card? (key order and input/output order do not count) */
export function sameCard(a: ProductSpec, b: ProductSpec): boolean {
  const key = (s: ProductSpec) =>
    JSON.stringify(
      Object.entries({ ...s, inputs: [...s.inputs].sort(), outputs: [...s.outputs].sort() }).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)),
    );
  return key(a) === key(b);
}

export function validateTurn(
  raw: unknown,
  opts: { mode: TurnMode; log: ClampLog; locale?: "en" | "ar" },
): { value: SpecTurn | null; errors: string[] } {
  const locale = opts.locale ?? "en";
  if (!isObj(raw)) {
    const shape = opts.mode === "refine" ? "{reply, changed, spec?}" : "{question, choices} or {spec}";
    return { value: null, errors: [`the answer must be a JSON object: ${shape}`] };
  }
  let spec: ProductSpec | undefined;
  const turnLog: ClampLog = [];
  if (isObj(raw.spec)) {
    if (typeof raw.spec.name !== "string" || !raw.spec.name.trim()) return { value: null, errors: ["spec.name is required"] };
    spec = clampSpec(raw.spec, turnLog);
  }
  if (opts.mode === "refine") {
    const reply = cleanReply(raw.reply, locale, turnLog);
    if (!reply) return { value: null, errors: ["reply is required: one or two plain sentences answering the user's message"] };
    opts.log.push(...turnLog);
    const diff = (Array.isArray(raw.diff) ? raw.diff : []).map((d) => cut(d, 100)).filter(Boolean).slice(0, 8);
    if (!spec) return { value: { kind: "reply", reply, changed: [], ...(diff.length ? { diff } : {}) }, errors: [] };
    return { value: { kind: "reply", reply, spec, changed: cleanChanged(raw.changed), ...(diff.length ? { diff } : {}) }, errors: [] };
  }
  if (spec) {
    const reply = cleanReply(raw.reply, locale, turnLog);
    opts.log.push(...turnLog);
    return { value: reply ? { kind: "spec", spec, reply } : { kind: "spec", spec }, errors: [] };
  }
  if (opts.mode === "force") return { value: null, errors: [`${MAX_QUESTIONS} questions were already asked: return the spec now, not a question`] };
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

/**
 * A turn our own rules answer without a model call (free — no ideation token):
 * "hi", "thanks", "are you stupid", an emoji, "?" get a canned answer; a vague idea
 * ("something with Arduino") gets one short question with chips.
 */
export function ruleTurn(idea: string, messages: ChatMessage[], locale: "en" | "ar", current: ProductSpec | null): SpecTurn | null {
  const canned = chatGuardTurn(idea, messages, locale, Boolean(current));
  if (canned) return canned;
  return current ? null : vagueTurn(idea, messages, locale);
}

export async function runSpecChat(opts: {
  call: StudioCall;
  idea: string;
  messages: ChatMessage[];
  locale: "en" | "ar";
  /** The spec card already shown: the last user message refines it. */
  current?: ProductSpec | null;
  /** W8: answers a repeated chat + card without a model call. */
  cache?: AiCache | null;
}): Promise<Outcome<SpecTurn>> {
  const ctx = { idea: opts.idea, messages: opts.messages, locale: opts.locale };
  const current = opts.current ?? null;

  const rules = ruleTurn(opts.idea, opts.messages, opts.locale, current);
  if (rules) return { ok: true, value: rules, source: "rules", clampLog: [], problems: [] };

  const key = specKey({ idea: opts.idea, messages: opts.messages, locale: opts.locale, current });
  return outcomeCached(opts.cache, key, () => modelTurn(opts, ctx, current));
}

async function modelTurn(
  opts: { call: StudioCall; idea: string; messages: ChatMessage[]; locale: "en" | "ar" },
  ctx: { idea: string; messages: ChatMessage[]; locale: "en" | "ar" },
  current: ProductSpec | null,
): Promise<Outcome<SpecTurn>> {
  const log: ClampLog = [];
  const mode: TurnMode = current ? "refine" : questionsAsked(opts.messages) >= MAX_QUESTIONS ? "force" : "ask";
  const r = await opts.call<SpecTurn>({
    step: "spec",
    system: SPEC_SYSTEM,
    prompt: specPrompt({ idea: opts.idea, messages: opts.messages, locale: opts.locale, forceSpec: mode === "force", current }),
    // 2026-10-18: once the card exists the whole understanding + spec come back on every turn.
    schema: mode === "refine" ? REFINE_RESPONSE_SCHEMA : SPEC_RESPONSE_SCHEMA,
    validate: (raw) => {
      // Only the accepted attempt's changes are kept.
      const attempt: ClampLog = [];
      const res = validateTurn(raw, { mode, log: attempt, locale: opts.locale });
      if (res.value) log.splice(0, log.length, ...attempt);
      return res;
    },
  });
  const guard = (spec: ProductSpec, into: ClampLog) => {
    const guarded = guardSpec(syncMovers(spec, into), ctx, into).spec;
    // Part F: a 4th strong servo would take the 5 A supply over budget (power rule).
    const capped = capStrongServos(guarded);
    if (capped !== guarded) into.push({ path: "actuators", from: guarded.actuators, to: capped.actuators });
    return capped;
  };
  const last = [...opts.messages].reverse().find((m) => m.role === "user")?.text ?? "";
  if (r.ok) return { ok: true, value: finish(r.value, current, guard, log, last, opts.locale), source: "model", clampLog: log, problems: [] };
  if (r.error !== "invalid") return { ok: false, error: r.error, clampLog: log, problems: r.problems };
  const fallback: ClampLog = [];
  if (current) {
    // The card with the visitor's own words applied ("add a buzzer"), never a blank one.
    const spec = guard(current, fallback);
    const words = FALLBACK_REPLY[opts.locale];
    const value: SpecTurn = sameCard(spec, current)
      ? { kind: "reply", reply: words.same, changed: [] }
      : { kind: "reply", reply: words.updated, spec, changed: [] };
    return { ok: true, value, source: "default", clampLog: fallback, problems: r.problems };
  }
  return {
    ok: true,
    value: { kind: "spec", spec: guard(defaultSpec(opts.idea, opts.messages, fallback), fallback) },
    source: "default",
    clampLog: fallback,
    problems: r.problems,
  };
}

/** A question ("who create you?", "what is UR10", "هل تعرف…؟"), not a change request. */
const ASKS =
  /[?؟]\s*$|^(?:what|who|whom|whose|how|why|when|where|which|do you|did you|does|are you|is (?:it|this|that|a|an|the)|tell me about)\b|^(?:ما|ماذا|من|مين|كيف|لماذا|ليش|هل|متى|أين|وين)\s/i;
/** "can you make it solar?" / "could you add a buzzer?" are change requests in a question's clothes. */
const ASKS_FOR_CHANGE =
  /\b(?:make|add|remove|drop|change|turn|switch|put|use|give|let)\b|\b(?:can|could|would) you\b|(?:اجعل|أضف|اضف|احذف|أزل|ازل|غيّر|ضع|استخدم)/i;
/** The user asked to take the movers away ("no motors", "بدون محركات"). */
const DROPS_MOVERS = /\b(?:no|without|remove|drop)\b[^.]{0,20}\b(?:motors?|servos?|joints?|pumps?|steppers?|actuators?)\b|(?:بدون|بلا|احذف|أزل|ازل)\s*(?:ال)?(?:محرك|سيرفو|مفاصل|مفصل|مضخ)/i;

/** Part F: a question without a change label is answered, never turned into a card change. */
export const isQuestionOnly = (text: string) => ASKS.test(text.trim()) && !ASKS_FOR_CHANGE.test(text);

/**
 * Part F (real-AI check): on a refine turn the model sometimes returns the card without
 * the fields it was not asked about. Movers and the scale note stay unless the user
 * took them away.
 */
export function keepCardFields(spec: ProductSpec, current: ProductSpec, lastUser: string, log: ClampLog): ProductSpec {
  let out = spec;
  if (current.actuators?.length && !spec.actuators?.length && !DROPS_MOVERS.test(lastUser)) {
    log.push({ path: "actuators", from: spec.actuators ?? null, to: current.actuators });
    out = { ...out, actuators: current.actuators };
    // The understanding lost its movers the same way: bring them back too (syncMovers would drop them again).
    if (out.understanding && current.understanding && !out.understanding.actuators.length) {
      out = { ...out, understanding: { ...out.understanding, actuators: current.understanding.actuators } };
    }
  }
  if (current.understanding && !spec.understanding) {
    log.push({ path: "understanding", from: null, to: "kept" });
    out = { ...out, understanding: current.understanding };
  }
  if (current.scaleNote && !spec.scaleNote) {
    log.push({ path: "scaleNote", from: null, to: current.scaleNote });
    out = { ...out, scaleNote: current.scaleNote };
  }
  return out;
}

/**
 * 2026-10-18: the understanding is what the user confirms, so its movers win: spec.actuators
 * (which the part picker counts) gets the same servo / motor / pump / stepper totals.
 * Small linear actuators have no spec kind and stay in the understanding only.
 */
export function syncMovers(spec: ProductSpec, log: ClampLog = []): ProductSpec {
  const u = spec.understanding;
  if (!u) return spec;
  let out = spec;
  for (const kind of ACTUATOR_KINDS) {
    const want = u.actuators.filter((a) => a.kind === kind).reduce((s, a) => s + a.count, 0);
    const have = actuatorTotals(out).find((t) => t.kind === kind)?.count ?? 0;
    if (want === have) continue;
    if (want === 0) {
      const rest = (out.actuators ?? []).filter((a) => a.kind !== kind);
      const { actuators: _drop, ...noActuators } = out;
      void _drop;
      out = rest.length ? { ...out, actuators: rest } : noActuators;
    } else {
      out = setActuatorCount(out, kind, want);
    }
  }
  if (out !== spec) log.push({ path: "actuators", from: spec.actuators ?? null, to: out.actuators ?? null });
  return out;
}

/** The guards on every spec; on a refine turn a spec equal to the card is no change at all. */
/** "6 joints" for every kind of actuator whose total changed between the two cards. */
export function countLabels(before: ProductSpec, after: ProductSpec, locale: "en" | "ar"): string[] {
  const was = new Map(actuatorTotals(before).map((t) => [t.kind, t.count]));
  return actuatorTotals(after)
    .filter((t) => was.get(t.kind) !== t.count)
    .map((t) => actuatorCountLabel(t.kind, t.count, locale));
}

function finish(
  turn: SpecTurn,
  current: ProductSpec | null,
  guard: (spec: ProductSpec, into: ClampLog) => ProductSpec,
  log: ClampLog,
  lastUser = "",
  locale: "en" | "ar" = "en",
): SpecTurn {
  if (turn.kind === "question") return turn;
  if (turn.kind === "spec") return { ...turn, spec: guard(turn.spec, log) };
  if (turn.diff?.length) log.push({ path: "diff", from: null, to: turn.diff });
  if (!turn.spec || !current) return { kind: "reply", reply: turn.reply, changed: [] };
  // A question that came back with a card but no change label: the card stays.
  if (!turn.changed.length && isQuestionOnly(lastUser)) {
    log.push({ path: "spec", from: "question with a spec", to: "dropped" });
    return { kind: "reply", reply: turn.reply, changed: [] };
  }
  const spec = guard(keepCardFields(turn.spec, current, lastUser, log), log);
  if (sameCard(spec, current)) return { kind: "reply", reply: turn.reply, changed: [] };
  // The model changed the card but named nothing: at least say the new motor count.
  return { ...turn, spec, changed: turn.changed.length ? turn.changed : countLabels(current, spec, locale) };
}
