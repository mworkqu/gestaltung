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
  PROCESS_MATERIALS,
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
// Each template contributes one part (Prototyping.part_<key>_name / _desc)
// when the brief names the THING the template describes — not merely a
// related idea. "Water" or "pump" alone does not mean a reservoir to design
// (a plant monitor waters from the client's own pot), so the reservoir
// template needs a container word. This is what stopped a cat-feeder
// "bowl housing" appearing in unrelated projects (audit #5).
//
// `name` is the template's own trigger words: a template's description is
// only ever attached to a part whose name matches them (templateForName).
//
// Material and process are NOT decided here: every suggested part, from any
// reader, goes through suggestSpec() below.

type PartTemplate = {
  key: string;
  kind: Discipline;
  when: (f: Set<Feature>, brief: string) => boolean;
  /** Words a part's name must contain for this template's text to apply. */
  name: RegExp;
};

const PART_TEMPLATES: PartTemplate[] = [
  {
    key: "enclosure",
    kind: "mechanical",
    when: (f) => f.has("enclosure") || f.has("outdoor"),
    name: /\b(enclosure|case|casing|housing|shell|body|box|cabinet)\b|علبة|غلاف|هيكل|صندوق|مبيت/i,
  },
  {
    key: "roof",
    kind: "mechanical",
    when: (f, b) => f.has("outdoor") && /\bsolar\b/i.test(b),
    name: /\b(roof|canopy|panel frame|solar)\b|سقف|مظلة/i,
  },
  {
    key: "dispenser",
    kind: "mechanical",
    when: (_f, b) => /\b(dispens\w*|hoppers?|feeders?|kibble|pellets?|grains?)\b|موزع|قادوس/i.test(b),
    name: /\b(dispens\w*|hoppers?|feed\w*)\b|موزع|توزيع|قادوس/i,
  },
  {
    key: "reservoir",
    kind: "mechanical",
    when: (_f, b) =>
      /\b(reservoirs?|tanks?|bowls?|basins?|containers?|jugs?|bottles?|troughs?|cisterns?)\b|خزان|وعاء|حوض/i.test(b),
    name: /\b(reservoirs?|tanks?|bowls?|basins?|containers?|troughs?)\b|خزان|وعاء|حوض/i,
  },
  {
    key: "bracket",
    kind: "mechanical",
    when: (f) => f.has("mounting") || f.has("enclosure"),
    name: /\b(brackets?|mounts?|mounting)\b|حامل|كتيفة/i,
  },
  {
    key: "pcb",
    kind: "electronics",
    when: (f) => f.has("electronics"),
    name: /\b(board|pcb|controller|circuit)\b|لوحة|دائرة/i,
  },
  {
    key: "coupling",
    kind: "mechanical",
    // A motor alone (a pump's, a fan's) is bought whole; a coupling is only
    // designed when the brief names the driven mechanism.
    when: (f, b) =>
      (f.has("precision") || f.has("moving")) &&
      /\b(couplings?|shafts?|gears?|augers?|splines?|keyways?|wheels?|rotat\w*|spin\w*|turntables?)\b/i.test(b),
    name: /\b(couplings?|shafts?|drive|gears?)\b|وصلة|عمود/i,
  },
];

export function breakDown(brief: string): { key: string; kind: Discipline }[] {
  const f = detect(brief);
  return PART_TEMPLATES.filter((r) => r.when(f, brief)).map(({ key, kind }) => ({ key, kind }));
}

/**
 * Whether a template's text (its description, and anything else it carries)
 * may be attached to a part with this name: only when the name contains the
 * template's own trigger words. "Plant pot mount" never gets the reservoir's
 * "holds the liquid side", whatever the brief says about water.
 */
export function templateAppliesTo(key: string, name: string): boolean {
  return PART_TEMPLATES.find((tpl) => tpl.key === key)?.name.test(name) ?? false;
}

// ── Manufacturing rules ────────────────────────────────────────────────────

// A material the text names outright. It always wins over a shape guess: an
// "aluminium enclosure" is aluminium, whatever an enclosure usually is.
const STATED_MATERIAL: [RegExp, Material][] = [
  [/\balumin(i)?um\b|ألومنيوم|الألمنيوم/, "aluminium_6061"],
  [/\bstainless\b|ستانلس|فولاذ مقاوم/, "stainless_304"],
  [/\b(mild )?steel\b|حديد/, "mild_steel"],
  [/\bbrass\b|نحاس/, "brass"],
  [/\bacrylic\b|perspex|plexi|أكريليك/, "acrylic"],
  [/\bplywood\b|خشب/, "plywood"],
  [/\bmdf\b/, "mdf"],
  [/\bcarbon fib(re|er)\b/, "carbon_fibre"],
  [/\bpetg\b/, "petg"],
  [/\babs\b/, "abs"],
  [/\bpla\b/, "pla"],
  [/\bresin\b/, "resin"],
];

// A process the text names outright ("3D-printed case", "laser-cut panel").
// Like a stated material, it wins over the shape guess. There is no separate
// sheet-metal process: a bent sheet part is cut flat on the laser first.
// Deliberately tight: "printed circuit board" is not a print, and "a machine
// that…" is not machining.
const STATED_PROCESS: [RegExp, Process][] = [
  [
    /\b3d[- ]?print\w*|\bprinted\b(?!\s+circuit)|\bfdm\b|\bsla\b|\bresin[- ]print\w*|\bpla\b|\bpetg\b|طباعة ثلاثية|مطبوع(ة)? (ثلاثي|بالطباعة)/,
    "3d_printing",
  ],
  [/\blaser[- ]?cut\w*|قص(ّ)? بالليزر|مقصوص(ة)? بالليزر/, "laser_cutting"],
  [/\bcnc\b|\bmachin(ed|ing)\b|تفريز|مشغول(ة)? آلي/, "cnc_machining"],
  [/\bsheet[- ]metal\b|\bbent (sheet|metal|steel|alumin(i)?um)\b|صاج|صفيح/, "laser_cutting"],
  [/\bedm\b|\bwire[- ]?(cut|erosion)\w*/, "edm"],
];

// Parts the BRIEF's own material/process words apply to. "A small 3D-printed
// case" is about the case, so it decides the "Enclosure shell" — not the drive
// coupling. A word in the part's own name or note always wins over the brief.
const ENCLOSURE_LIKE =
  /\b(enclosures?|case|casing|housings?|shell|box|cabinet|covers?|lids?|body|brackets?|mounts?|stand|frame)\b|علبة|غلاف|هيكل|صندوق|مبيت|حامل|غطاء/;

const statedMaterial = (t: string) => STATED_MATERIAL.find(([re]) => re.test(t))?.[1];
const statedProcess = (t: string) => STATED_PROCESS.find(([re]) => re.test(t))?.[1];
const works = (process: Process, material: Material) =>
  (PROCESS_MATERIALS[process] as readonly Material[]).includes(material);

/** The material to use for a process nobody named a material for. */
function materialFor(process: Process, shape: Material, hot: boolean): Material {
  // A print that lives outdoors or in Gulf heat is PETG: PLA softens in a car.
  if (process === "3d_printing") return hot ? "petg" : "pla";
  return works(process, shape) ? shape : PROCESS_MATERIALS[process][0];
}

export type SpecSuggestion = { material: Material; process: Process; reasonKey: string };

/**
 * Material + process for a part, from what the part is. A fixed table over
 * the part's own name and description, so the same part always gets the same
 * answer and the reason can be shown.
 *
 * Precedence: words in the part's own text, then words in the project brief
 * (enclosure-like parts only), then the shape guess. The pair returned is
 * always makeable (PROCESS_MATERIALS); when two stated words clash, the one
 * from the part's own text wins, and between two of the same level the
 * material wins.
 */
export function suggestSpec(text: string, briefText = ""): SpecSuggestion {
  const t = text.toLowerCase();
  const enclosureLike = ENCLOSURE_LIKE.test(t);
  // A case "for the controller board" is still a case.
  if (!enclosureLike && /\b(pcb|board|circuit|sensor|electronic|controller)\b/.test(t))
    return { material: "fr4", process: "pcb_manufacturing", reasonKey: "electronics" };

  const b = enclosureLike ? briefText.toLowerCase() : "";
  const shape = suggestFromShape(t);
  const hot = /\bpetg\b/.test(`${t} ${b}`) || FEATURES.heat.test(`${t} ${briefText}`) || FEATURES.outdoor.test(`${t} ${briefText}`);

  const partMat = statedMaterial(t);
  const partProc = statedProcess(t);
  const briefMat = b ? statedMaterial(b) : undefined;
  const briefProc = b ? statedProcess(b) : undefined;

  // Each side at its own level: part words first, brief words fill the gaps.
  const material = partMat ?? briefMat;
  const process = partProc ?? briefProc;
  const matLevel = partMat ? 2 : briefMat ? 1 : 0;
  const procLevel = partProc ? 2 : briefProc ? 1 : 0;
  const reasonKey = matLevel === 2 || procLevel === 2 ? "stated" : matLevel || procLevel ? "brief" : shape.reasonKey;

  if (material && process) {
    if (works(process, material)) return { material, process, reasonKey };
    // A clash: the higher level keeps its word; a tie keeps the material.
    if (procLevel > matLevel) return { material: materialFor(process, shape.material, hot), process, reasonKey };
    return { material, process: works(shape.process, material) ? shape.process : processesFor(material)[0], reasonKey };
  }
  if (material) {
    // Keep the shape's usual process when it can work that material.
    return { material, process: works(shape.process, material) ? shape.process : processesFor(material)[0], reasonKey };
  }
  if (process) return { material: materialFor(process, shape.material, hot), process, reasonKey };
  return shape;
}

function suggestFromShape(t: string): SpecSuggestion {
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
