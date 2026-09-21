// The prototyping rules — deterministic, free, and explainable.
//
// Two jobs live here:
//   1. The BASIC READER: keyword rules over the brief. It is the fallback when
//      the configured analysis provider is missing, rate-limited or returns
//      something malformed (lib/prototyping/providers/rules.ts wraps it into
//      the same contract a model returns).
//   2. The MANUFACTURING RULES, which never go to a model: which material and
//      process suit a part (suggestSpec), which pairs are makeable
//      (constants.PROCESS_MATERIALS) and how the parts group into a route
//      (recommend). These must be repeatable, so they are a fixed table.
//
// Nothing here scores itself. A keyword match is not a measurement, so no
// output carries a confidence number.
//
// PURE, and returns message KEYS rather than sentences: the caller translates,
// so every reading is bilingual.

import {
  PROCESSES,
  isCompatible,
  processesFor,
  type Discipline,
  type Material,
  type Process,
} from "./constants";

// ── Feature detection ──────────────────────────────────────────────────────
// One regex per idea we can recognise. Anything we don't recognise simply
// doesn't fire, and the client fills the gap by hand — which is the honest
// failure mode for a keyword reader.

const FEATURES = {
  outdoor: /\b(outdoor|outside|public|street|park|kerb|curb|garden|rain|sun|weather)\b/i,
  indoor: /\b(indoor|inside|office|kitchen|room|desk|shelf|home)\b/i,
  heat: /\b(hot|heat|summer|thermal|doha|qatar|gulf)\b/i,
  water: /\b(water|liquid|pump|tank|drink|fluid|irrigat\w*)\b/i,
  food: /\b(food|feed\w*|dispens\w*|hopper|grain|pellet|kibble)\b/i,
  electronics: /\b(smart|sensor|app|wifi|wi-fi|bluetooth|schedule|monitor|report|microcontroller|esp32|arduino|pcb|circuit|electronic\w*)\b/i,
  power: /\b(solar|battery|off-grid|offgrid|mains|power|charg\w*)\b/i,
  washdown: /\b(wash|hose|clean|hygien\w*|steril\w*|food-safe|food safe)\b/i,
  security: /\b(tamper|lock\w*|vandal\w*|theft|secure|anti-theft)\b/i,
  enclosure: /\b(enclosure|housing|box|cabinet|case|station|body|shell|frame)\b/i,
  mounting: /\b(mount\w*|wall|post|pole|ground|bolt\w*|bracket|anchor|fix\w*)\b/i,
  precision: /\b(precision|tolerance|coupling|keyway|gear|shaft|bearing|motor|spline)\b/i,
  moving: /\b(motor|servo|rotat\w*|spin\w*|auger|screw|actuat\w*|moving)\b/i,
} as const;

type Feature = keyof typeof FEATURES;

function detect(brief: string): Set<Feature> {
  const found = new Set<Feature>();
  for (const [k, re] of Object.entries(FEATURES)) {
    if (re.test(brief)) found.add(k as Feature);
  }
  return found;
}

/** First number followed by a unit, e.g. "2 kg" or "5 L". */
function firstQuantity(brief: string, unit: RegExp): string | null {
  const m = brief.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(${unit.source})\\b`, "i"));
  return m ? `${m[1]} ${m[2]}` : null;
}

function batchSize(brief: string): number | null {
  const m =
    brief.match(/\b(?:batch|run|pilot|order)\s+of\s+(\d{1,5})\b/i) ??
    brief.match(/\b(\d{1,5})\s*(?:units?|pieces|pcs)\b/i);
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ── Disciplines ────────────────────────────────────────────────────────────
// A board is implied by anything smart or powered; software only by something
// a person or system talks to.

const SOFTWARE =
  /\b(apps?|website|web\s?app|dashboard|cloud|firmware|software|online|remote(?:ly)?|api|wi-?fi|bluetooth|iot)\b/i;

const MECHANICAL: Feature[] = [
  "enclosure",
  "mounting",
  "precision",
  "moving",
  "outdoor",
  "food",
  "water",
  "security",
  "washdown",
];

export function detectDisciplines(brief: string): Discipline[] {
  const f = detect(brief);
  const out: Discipline[] = [];
  if (MECHANICAL.some((k) => f.has(k))) out.push("mechanical");
  if (f.has("electronics") || f.has("power")) out.push("electronics");
  if (SOFTWARE.test(brief)) out.push("software");
  return out;
}

export type PowerSource = "solar" | "battery" | "mains";

/** How the brief says the product is powered, or null if it doesn't say. */
export function powerSource(brief: string): PowerSource | null {
  if (/\b(solar|off-?grid)\b/i.test(brief)) return "solar";
  if (/\b(batter(y|ies)|rechargeable)\b/i.test(brief)) return "battery";
  if (/\b(mains|plug(ged)?\s+in|wall\s+socket|2[234]0\s?v)\b/i.test(brief)) return "mains";
  return null;
}

// ── Facts ──────────────────────────────────────────────────────────────────
// What the brief states. Standard facts (quantity / power / mounting /
// environment) carry a raw option value; the rest carry a message key the
// caller translates. A fact the brief does not state is simply absent — the
// contract turns it into a question instead of a guess.

export type Fact = {
  id: string;
  /** Raw value for standard facts. */
  value?: string;
  /** Message key (Prototyping.factValue_*) for descriptive facts. */
  valueKey?: string;
  params?: Record<string, string>;
};

export function readFacts(brief: string): Fact[] {
  const f = detect(brief);
  const facts: Fact[] = [];

  const batch = batchSize(brief);
  if (batch) facts.push({ id: "quantity", value: String(batch) });

  const power = powerSource(brief);
  if (power) facts.push({ id: "power", value: power });

  if (/\b(portable|handheld|carry|carried|mobile)\b/i.test(brief))
    facts.push({ id: "mounting", value: "portable" });
  else if (/\b(bolt\w*|mounted|wall|post|pole|anchor\w*|fixed)\b/i.test(brief))
    facts.push({ id: "mounting", value: "fixed" });

  if (f.has("outdoor") && f.has("indoor")) facts.push({ id: "environment", value: "both" });
  else if (f.has("outdoor")) facts.push({ id: "environment", value: "outdoor" });
  else if (f.has("indoor")) facts.push({ id: "environment", value: "indoor" });

  if (f.has("heat")) facts.push({ id: "heat", valueKey: "heat" });
  if (f.has("washdown")) facts.push({ id: "washdown", valueKey: "washdown" });
  if (f.has("electronics")) facts.push({ id: "electronics", valueKey: "electronics" });
  if (f.has("security")) facts.push({ id: "security", valueKey: "security" });

  const mass = firstQuantity(brief, /kg|g|grams?|kilograms?/);
  const volume = firstQuantity(brief, /l|litres?|liters?|ml/);
  if (mass || volume)
    facts.push({
      id: "capacity",
      valueKey: mass && volume ? "capacityBoth" : "capacityOne",
      params: { mass: mass ?? "", volume: volume ?? "", amount: (mass ?? volume)! },
    });

  return facts;
}

// ── Part breakdown ─────────────────────────────────────────────────────────
// Each rule contributes one part (Prototyping.part_<key>_name / _desc) when
// its feature fires. Material and process are NOT decided here: every
// suggested part, from any reader, goes through suggestSpec() below.

const PART_RULES: { when: (f: Set<Feature>, brief: string) => boolean; key: string; kind: Discipline }[] = [
  { when: (f) => f.has("enclosure") || f.has("outdoor"), key: "enclosure", kind: "mechanical" },
  { when: (f, b) => f.has("outdoor") && /\bsolar\b/i.test(b), key: "roof", kind: "mechanical" },
  { when: (f) => f.has("food"), key: "dispenser", kind: "mechanical" },
  { when: (f) => f.has("water"), key: "reservoir", kind: "mechanical" },
  { when: (f) => f.has("mounting") || f.has("enclosure"), key: "bracket", kind: "mechanical" },
  { when: (f) => f.has("electronics"), key: "pcb", kind: "electronics" },
  { when: (f) => f.has("precision") || f.has("moving"), key: "coupling", kind: "mechanical" },
];

export function breakDown(brief: string): { key: string; kind: Discipline }[] {
  const f = detect(brief);
  return PART_RULES.filter((r) => r.when(f, brief)).map(({ key, kind }) => ({ key, kind }));
}

// ── Manufacturing rules ────────────────────────────────────────────────────

/**
 * Material + process for a part, from what the part is. A fixed table over
 * the part's own name and description, so the same part always gets the same
 * answer and the reason can be shown.
 */
export function suggestSpec(text: string): { material: Material; process: Process; reasonKey: string } {
  const t = text.toLowerCase();
  if (/\b(pcb|board|circuit|sensor|electronic|controller)\b/.test(t))
    return { material: "fr4", process: "pcb_manufacturing", reasonKey: "electronics" };
  if (/\b(key|keyway|coupling|spline|gear|tolerance|precision)\b/.test(t))
    return { material: "stainless_304", process: "edm", reasonKey: "precision" };
  if (/\b(lid|hatch|door|panel|cover|shell|sheet|plate|bracket|frame|enclosure|roof)\b/.test(t))
    return { material: "stainless_304", process: "laser_cutting", reasonKey: "sheet" };
  if (/\b(housing|bowl|clip|knob|cap|funnel|seal|gasket|spacer|mount|hopper|reservoir|dispenser)\b/.test(t))
    return { material: "petg", process: "3d_printing", reasonKey: "shaped" };
  return { material: "aluminium_6061", process: "cnc_machining", reasonKey: "generic" };
}

export type PartLike = {
  code: string;
  name: string;
  quantity: number;
  material: string | null;
  process: string | null;
};

export type Warning = {
  key: string;
  params: Record<string, string | number>;
  /** blocking warnings stop the route from being accepted. */
  blocking: boolean;
};

export type Route = {
  process: Process;
  parts: PartLike[];
  /** Same material throughout, so the parts can be batched together. */
  nestable: boolean;
};

export type Recommendation = { routes: Route[]; warnings: Warning[] };

export function recommend(parts: PartLike[], brief = ""): Recommendation {
  const hot = FEATURES.heat.test(brief) || FEATURES.outdoor.test(brief);
  const wet = FEATURES.washdown.test(brief) || FEATURES.water.test(brief);

  const routes: Route[] = PROCESSES.map((process) => {
    const list = parts.filter((p) => p.process === process);
    return {
      process,
      parts: list,
      nestable: list.length > 1 && new Set(list.map((p) => p.material)).size === 1,
    };
  }).filter((r) => r.parts.length);

  const warnings: Warning[] = [];
  for (const p of parts) {
    const params = { code: p.code, name: p.name };
    if (!p.material || !p.process) {
      warnings.push({ key: "unset", params, blocking: true });
      continue;
    }
    if (!isCompatible(p.material, p.process)) {
      warnings.push({
        key: "incompatible",
        params: {
          ...params,
          material: p.material,
          process: p.process,
          alt: processesFor(p.material).join(","),
        },
        blocking: true,
      });
      continue;
    }
    // Soft warnings: the pair is makeable, but wrong for what the brief says.
    if (p.material === "pla" && hot) warnings.push({ key: "pla_heat", params, blocking: false });
    if (p.material === "mild_steel" && wet) warnings.push({ key: "steel_rust", params, blocking: false });
    if (p.material === "acrylic" && hot) warnings.push({ key: "acrylic_brittle", params, blocking: false });
    if ((p.material === "plywood" || p.material === "mdf") && wet)
      warnings.push({ key: "wood_wet", params, blocking: false });
  }

  return { routes, warnings };
}
