// The brief-analysis contract, shared by the server route, every provider and
// the client. Types and pure helpers only — the zod schema that enforces this
// shape lives in ./analysis-schema (server-only, so zod stays out of the
// browser bundle).
//
// There is deliberately no confidence anywhere in this contract: a percentage
// implies a measurement no provider is making.

import type { Discipline } from "./constants";

export type FactSource = "brief" | "assumed";

export type Requirement = { id: string; label: string; value: string; source: FactSource };

export type QuestionType = "number" | "select" | "boolean";

export type Question = { id: string; label: string; type: QuestionType; options?: string[] };

export type SuggestedPart = { name: string; kind: Discipline; note: string };

export const BOM_KINDS = ["electronics", "mechanical", "consumable"] as const;
export type BomKind = (typeof BOM_KINDS)[number];

/** A thing to buy, as a function and a spec — never a product, price or brand. */
export type BomLine = {
  id: string;
  /** A short name for the item ("rechargeable battery"), not a sentence. */
  function: string;
  spec: string;
  quantity: number;
  kind: BomKind;
  critical: boolean;
  /** Attribute class and target values (lib/store/attributes), when known. */
  class?: string;
  attributes?: Record<string, unknown>;
  /** Display group (boards, sensors, discrete, consumables, hardware, fabrication). */
  group?: string;
};

export const BUILD_ROUTES = ["prototype", "custom_pcb"] as const;
export type BuildRoute = (typeof BUILD_ROUTES)[number];

/** The analysis's advice on how to build the electronics — advice, never a decision. */
export type RouteRecommendation = { recommended: BuildRoute; reason: string };

export type Analysis = {
  /** One plain-language paragraph. Empty when the provider cannot summarise. */
  summary: string;
  disciplines: Discipline[];
  requirements: Requirement[];
  questions: Question[];
  suggestedParts: SuggestedPart[];
  /** Empty from the basic reader: keyword rules cannot write a bill of materials. */
  bom: BomLine[];
  /** Only when the product has electronics. */
  electronicsRoute?: RouteRecommendation | null;
};

/** What the client already decided; a provider treats these as settled. */
export type Answer = { id: string; label: string; value: string | null };

export type AnalysisRequest = {
  brief: string;
  answers: Answer[];
  locale: "en" | "ar";
  /** For metering only: which project the call is billed to. */
  projectId?: string;
};

export const ANALYSIS_STEPS = ["reading", "disciplines", "requirements", "gaps"] as const;
export type AnalysisStep = (typeof ANALYSIS_STEPS)[number];

/** Why the basic reader was used instead of the configured provider. */
export type FallbackReason = "missing_key" | "rate_limited" | "malformed" | "unavailable" | "paused";

/** One line of the /api/analyse NDJSON stream. */
export type AnalysisEvent =
  | { type: "step"; step: AnalysisStep }
  | { type: "result"; analysis: Analysis; provider: string; fallback: FallbackReason | null }
  | { type: "error" };

// ── Standard facts ─────────────────────────────────────────────────────────
// Four things every physical product needs settled. Whatever a provider
// returns, each of these ends up either as a fact with a valid value or as a
// question the client answers with a real control.

export const STANDARD_FACTS = {
  quantity: { type: "number" },
  power: { type: "select", options: ["mains", "battery", "solar"] },
  mounting: { type: "select", options: ["fixed", "portable"] },
  environment: { type: "select", options: ["indoor", "outdoor", "both"] },
} as const satisfies Record<string, { type: QuestionType; options?: readonly string[] }>;

export type StandardFact = keyof typeof STANDARD_FACTS;

export const isStandardFact = (id: string): id is StandardFact => id in STANDARD_FACTS;

/** A standard fact's value is only usable if it is one of its options. */
function validStandardValue(id: StandardFact, value: string): boolean {
  const f = STANDARD_FACTS[id];
  if (f.type === "number") return /^\d+$/.test(value.trim()) && Number(value) > 0;
  return (f.options as readonly string[]).includes(value);
}

/**
 * Normalise any provider's output: an invalid standard value becomes a
 * question, every standard fact that is neither known nor asked is asked, and
 * no question duplicates a known fact.
 */
export function withStandardGaps(a: Analysis): Analysis {
  const requirements: Requirement[] = [];
  const questions = [...a.questions];
  for (const r of a.requirements) {
    if (isStandardFact(r.id) && !validStandardValue(r.id, r.value)) continue;
    requirements.push(isStandardFact(r.id) ? { ...r, value: r.value.trim() } : r);
  }
  const known = new Set(requirements.map((r) => r.id));
  for (const id of Object.keys(STANDARD_FACTS) as StandardFact[]) {
    if (known.has(id) || questions.some((q) => q.id === id)) continue;
    const f = STANDARD_FACTS[id];
    questions.push({ id, label: id, type: f.type, options: "options" in f ? [...f.options] : undefined });
  }
  return {
    ...a,
    requirements,
    // Standard questions always use our own type and options, whatever came back.
    questions: questions
      .filter((q) => !known.has(q.id))
      .map((q) => {
        if (!isStandardFact(q.id)) return q;
        const f = STANDARD_FACTS[q.id];
        return { ...q, type: f.type, options: "options" in f ? [...f.options] : undefined };
      }),
  };
}

// ── Source honesty ─────────────────────────────────────────────────────────
// A provider says where each fact came from, and it can be wrong: a model read
// "USB adapter, on a desk" and reported Mains + Portable "from your brief"
// (audit #5). So the claim is checked against the brief's own words, the same
// way for every provider: a fact keeps source "brief" only if the brief
// actually says it. Anything else is "assumed" (shown as inferred). Values are
// never changed here — only the label on where they came from.

/**
 * Words that settle a standard fact's value, EN + AR, over lower-case text.
 * Deliberately narrower than the keyword reader's: "inside the case", "post
 * data" or "mobile app" say nothing about where the product lives. A desk says
 * indoor; it does not say fixed or portable.
 */
const STANDARD_WORDS: Record<string, RegExp> = {
  "power:mains":
    /\bmains\b|\bplug(ged|s)?\b(\s+[\w']+){0,3}?\s+in(to)?\b|\bwall (socket|outlet|plug)\b|\b2[234]0\s?v\b|\bac power\b|مقبس|قابس|كهرباء المنزل|الكهرباء المنزلية|الشبكة الكهربائية|تيار متردد/,
  "power:battery": /\bbatter(y|ies)\b|\brechargeable\b|\bli-?ion\b|\blipo\b|\b18650\b|بطارية|بطاريات|قابلة? لإعادة الشحن/,
  "power:solar": /\bsolar\b|\boff-?grid\b|شمسي|شمسية/,
  "mounting:fixed":
    /\bfixed\b|\bmounted\b|\bwall[- ]mount\w*|\bon (a|the) wall\b|\bbolt\w*|\bscrewed (to|on)\b|\bpole\b|\banchor\w*|ثابت|مثبت|مثبّت|على الجدار|على الحائط|جداري|حائطي/,
  "mounting:portable": /\bportable\b|\bhand-?held\b|\bcarried\b|\bcarry (it|around)\b|\bpocket\b|محمول|متنقل|يحمل باليد/,
  "environment:indoor":
    /\bindoors?\b|\boffice\b|\bkitchen\b|\b(bed)?rooms?\b|\bdesk\w*\b|\bshelf\b|\bhome\b|داخلي|مكتب|غرفة|منزل|بيت|مطبخ/,
  "environment:outdoor":
    /\boutdoors?\b|\bpublic\b|\bstreet\b|\bpark\b|\bgarden\b|\brain\b|\bsun\b|\bweather\w*\b|\byard\b|\bbalcon\w*|\bterraces?\b|\bpatios?\b|\broof(top)?s?\b|خارجي|حديقة|شارع|مطر|شرفة|بلكونة/,
};

/** Western digits, lower case, one space: the form both sides are compared in. */
function normalise(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    // Thousands separators go: "1,000 units" is 1000.
    .replace(/(\d)[,٬](?=\d{3}(?!\d))/g, "$1")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const hasNumber = (text: string, n: string) =>
  // Not part of a longer number, and not a model number: "ESP32" is no "32".
  new RegExp(`(^|[^a-z\\u0600-\\u06ff\\d.,])${n.replace(/[.,]/g, "[.,]")}(?!\\d|[.,]\\d)`).test(text);

const STOP = new Set(
  "with from that this have will must should into about each which their there when where what than then also only very more less some such other used uses using need needs product device unit units the and for per".split(
    " "
  )
);

/** A word's comparable stem: Arabic loses its article, both are cut short. */
function stem(w: string): string {
  if (/[؀-ۿ]/.test(w)) return w.replace(/^(و?(بال|لل|ال))/, "").slice(0, 4);
  return w.slice(0, 5);
}

/**
 * Whether the brief says a free-text value: the value appears whole, or every
 * number in it appears and at least half its content words do.
 */
function briefMentions(brief: string, value: string): boolean {
  const b = normalise(brief);
  const v = normalise(value);
  if (!v) return false;
  if (b.includes(v)) return true;
  const numbers = v.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numbers.some((n) => !hasNumber(b, n))) return false;
  const words = v
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => !STOP.has(w) && !/^\d/.test(w) && w.length >= (/[؀-ۿ]/.test(w) ? 3 : 4));
  if (!words.length) return numbers.length > 0;
  const hits = words.filter((w) => {
    const s = stem(w);
    return s.length >= 3 && b.includes(s);
  }).length;
  return hits * 2 >= words.length;
}

/** Whether the brief itself states this fact's value. */
export function briefStates(id: string, value: string, brief: string): boolean {
  const b = normalise(brief);
  const v = value.trim().toLowerCase();
  if (id === "quantity") return /^\d+$/.test(v) && hasNumber(b, String(Number(v)));
  if (id === "environment" && v === "both")
    return STANDARD_WORDS["environment:indoor"].test(b) && STANDARD_WORDS["environment:outdoor"].test(b);
  const words = STANDARD_WORDS[`${id}:${v}`];
  if (words) return words.test(b);
  // A standard fact with a value we have no words for is never "from the brief".
  if (isStandardFact(id)) return false;
  return briefMentions(brief, value);
}

/** Every fact claimed "from the brief" that the brief doesn't state becomes "assumed". */
export function honestSources(requirements: Requirement[], brief: string): Requirement[] {
  return requirements.map((r) =>
    r.source === "brief" && !briefStates(r.id, r.value, brief) ? { ...r, source: "assumed" } : r
  );
}
