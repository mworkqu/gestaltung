// Which enclosure template suits a product, and why (W6). Pure rules, no AI:
//
//  * shapeSignals() reads the ProductSpec: where it lives (use + any placement /
//    holding words), how big it is, indoor or outdoor, what it shows or plays,
//    and the idea's own words (plant, round, lamp, sensor …, EN + AR);
//  * rankShapes() scores EVERY template for those signals, best first, each with
//    the reason that earned its score (a message key under Studio.shape.why_*);
//  * templateFor() / defaultEnclosureFor() = the first one (the AI fallback);
//  * shapeVariants() = the next three DIFFERENT templates, adapted from the
//    current look (colour, finish, lid name kept) for "Other shapes";
//  * applyShapePick() makes a FIRST look follow a strong rule (a plant idea gets
//    a pot-friendly shape even when the model drew a box).
//
// Spec fields are read defensively: placement / holding words may arrive as new
// optional fields (W3), so they are looked up by name and only used when they
// are strings (or string arrays).

import {
  DEFAULT_ENCLOSURE,
  ENCLOSURE_TEMPLATES,
  clampEnclosure,
  type EnclosureSpec,
  type EnclosureTemplate,
  type ProductSpec,
} from "../schema";

/** Why a template fits (Studio.shape.why_<reason>). `fit_<template>` = a plain fallback line. */
export type ShapeReason =
  | "plant"
  | "pot"
  | "wall"
  | "wearable"
  | "pocket"
  | "handheld"
  | "screen"
  | "tall_output"
  | "round_output"
  | "round_small"
  | "outdoor"
  | "desk"
  | `fit_${EnclosureTemplate}`;

export type RankedShape = { template: EnclosureTemplate; reason: ShapeReason; score: number };

/** A rule that beats the model on the FIRST look (plant, wall, wearable, handheld …). */
export const STRONG_SCORE = 70;
/** Templates that sit happily in or next to a plant pot. */
export const POT_FRIENDLY: readonly EnclosureTemplate[] = ["stake_pod", "dome_base", "puck"];

// Small base priorities: the order of the "fit" fallbacks (and of ties).
const BASE: Record<EnclosureTemplate, number> = {
  rounded_box: 20,
  puck: 12,
  dome_base: 11,
  pill: 10,
  soft_wedge: 9,
  handheld_taper: 8,
  lantern: 7,
  wall_plate: 2,
  stake_pod: 1,
};

const PLANT_EN =
  /\b(plants?|soil|gardens?|gardening|pots?|potted|planter|planters|watering|waterer|irrigat\w*|seedlings?|herbs?|flowers?|greenhouse|moisture|lawn|crops?|hydroponic\w*|succulents?)\b/;
const PLANT_AR = /(نبات|نبتة|نباتات|تربة|التربة|حديقة|الحديقة|سقي|السقي|الري|أصيص|اصيص|زرع|زراعة|الزراعة|أزهار|زهور|شتلة)/;
const PLACE_PLANT = /\b(pot|pots|soil|stake|staked|garden|planter|in the ground)\b|(أصيص|تربة|حديقة)/;
const PLACE_WALL = /\b(wall|walls|mounted|mount on)\b|(حائط|جدار)/;
const PLACE_WEAR = /\b(wrist|wear|wearable|worn|body|clip|strap|neck|belt|arm)\b|(معصم|يلبس|الجسم)/;
const PLACE_HAND = /\b(hand|hands|handheld|held|grip|holding)\b|(اليد|باليد)/;
const PLACE_DESK = /\b(desk|table|shelf|bedside|counter)\b|(مكتب|طاولة|رف)/;
const ROUND = /\b(round|circular|puck|disc|disk|coaster|dome|domed)\b|(دائري|مستدير|قبة)/;
const LAMP = /\b(lamp|light|lights|nightlight|glow|lantern)\b|(مصباح|ضوء|إضاءة|فانوس)/;
const SENSOR = /\b(sensor|motion|presence|pir|detector|smoke|air|temperature|humidity)\b|(مستشعر|حساس|حركة|حرارة|رطوبة)/;
const RING = /\b(ring|neopixel|ws2812|rgb)\b/;

/** Optional spec fields that may carry "where it lives / how it is held" words (W3 may add them). */
const PLACE_KEYS = ["placement", "place", "location", "mount", "mounting", "holding", "holdingStyle", "hold", "where", "position"];

function stringsOf(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

export type ShapeSignals = {
  plant: boolean;
  wall: boolean;
  wearable: boolean;
  handheld: boolean;
  desk: boolean;
  pocket: boolean;
  small: boolean;
  big: boolean;
  outdoor: boolean;
  screen: boolean;
  speaker: boolean;
  tallOutput: boolean;
  round: boolean;
  lampish: boolean;
  sensorish: boolean;
};

export function shapeSignals(spec: ProductSpec): ShapeSignals {
  const o = spec as unknown as Record<string, unknown>;
  const use = typeof o.use === "string" ? o.use : "";
  const text = [spec.name, spec.oneLine, ...(Array.isArray(spec.features) ? spec.features : [])]
    .filter((s): s is string => typeof s === "string")
    .join(" ")
    .toLowerCase();
  const place = [use, ...PLACE_KEYS.flatMap((k) => stringsOf(o[k]))].join(" ").toLowerCase().replace(/_/g, " ");
  const outputs: string[] = Array.isArray(spec.outputs) ? spec.outputs : [];
  const size = typeof o.sizeHint === "string" ? o.sizeHint : "";
  const lampish = LAMP.test(text);
  const ring = RING.test(text);
  const wall = use === "wall" || PLACE_WALL.test(place);
  return {
    plant: PLANT_EN.test(text) || PLANT_AR.test(text) || PLACE_PLANT.test(place),
    wall,
    wearable: use === "wearable" || PLACE_WEAR.test(place),
    handheld: use === "handheld" || PLACE_HAND.test(place),
    desk: use === "desk" || PLACE_DESK.test(place),
    pocket: size === "pocket",
    small: size === "pocket" || size === "palm",
    big: size === "desk" || size === "large",
    outdoor: o.environment === "outdoor" || use === "outdoor",
    screen: outputs.includes("screen"),
    speaker: outputs.includes("speaker"),
    tallOutput: outputs.includes("speaker") || (outputs.includes("led") && (ring || lampish)),
    round: ROUND.test(text),
    lampish,
    sensorish: SENSOR.test(text),
  };
}

/** Every template scored for this product, best first (ties keep BASE order). */
export function rankShapes(spec: ProductSpec): RankedShape[] {
  const s = shapeSignals(spec);
  const carried = s.handheld || s.wearable;
  const scored = new Map<EnclosureTemplate, { score: number; reason: ShapeReason }>();
  const add = (t: EnclosureTemplate, score: number, reason: ShapeReason) => {
    const cur = scored.get(t);
    if (!cur || score > cur.score) scored.set(t, { score, reason });
  };
  for (const t of ENCLOSURE_TEMPLATES) add(t, 0, `fit_${t}`);

  // Plants: a pod on a soil spike first, then the round pot-friendly shapes.
  if (s.plant) {
    add("stake_pod", s.wall ? 60 : 100, "plant");
    add("dome_base", 55, "pot");
    add("puck", 50, "pot");
  }
  if (s.wall) add("wall_plate", 95, "wall");
  if (s.wearable) {
    add("pill", 90, "wearable");
    add("puck", 40, "wearable");
  }
  if (s.handheld) add(s.pocket ? "pill" : "handheld_taper", s.pocket ? 86 : 88, s.pocket ? "pocket" : "handheld");
  if (s.handheld && !s.pocket) add("pill", 45, "handheld");
  if (s.pocket) add("pill", 60, "pocket");
  // Tall light / speaker products standing on a desk.
  if (s.tallOutput && !carried && s.big) add("lantern", 80, "tall_output");
  // Round sensors / lamps / speakers on a desk.
  if (s.round && !carried && (s.sensorish || s.lampish || s.speaker)) add("dome_base", 78, "round_output");
  if (s.round && s.small) add("puck", 70, "round_small");
  if (s.desk && s.screen) add("soft_wedge", 75, "screen");
  else if (s.screen && !carried) add("soft_wedge", 30, "screen");
  if (s.outdoor) add("rounded_box", 40, "outdoor");
  if (s.desk && !s.plant) add("rounded_box", 25, "desk");

  const out: RankedShape[] = ENCLOSURE_TEMPLATES.map((t) => {
    const v = scored.get(t)!;
    // Things in a hand or on the body never stand as a lantern / dome / wedge / wall plate / stake.
    const penalty = carried && ["lantern", "dome_base", "soft_wedge", "wall_plate", "stake_pod"].includes(t) ? 15 : 0;
    return { template: t, reason: v.reason, score: v.score + BASE[t] - penalty };
  });
  return out.sort((a, b) => b.score - a.score || BASE[b.template] - BASE[a.template]);
}

/** The rule-picked template for a product (the AI's fallback and the "first look" anchor). */
export function templateFor(spec: ProductSpec): EnclosureTemplate {
  return rankShapes(spec)[0].template;
}

/** Why `template` suits this product (its ranked reason). */
export function shapeReason(spec: ProductSpec, template: EnclosureTemplate): ShapeReason {
  return rankShapes(spec).find((r) => r.template === template)?.reason ?? `fit_${template}`;
}

/**
 * `base` turned into `template`: proportions, feet, vents and corners that suit that
 * template (as defaultEnclosureFor would choose them), everything else (colour, finish,
 * accent, lid name, wall, clearance) kept. Always valid (clampEnclosure).
 */
export function adaptEnclosure(base: EnclosureSpec, template: EnclosureTemplate, spec: ProductSpec): EnclosureSpec {
  const s = shapeSignals(spec);
  const square = template === "puck" || template === "dome_base" || template === "lantern" || template === "stake_pod";
  const widthToDepth = square
    ? 1
    : template === "pill" || template === "handheld_taper"
      ? 2
      : base.template === "puck" || base.template === "dome_base" || base.template === "lantern" || base.template === "stake_pod" ||
          base.template === "pill" || base.template === "handheld_taper"
        ? 1.4
        : base.proportions.widthToDepth;
  const heightBias: EnclosureSpec["proportions"]["heightBias"] =
    s.wall || template === "puck" || template === "wall_plate" ? "low" : template === "lantern" ? "tall" : base.proportions.heightBias === "low" ? "mid" : base.proportions.heightBias;
  const feet: EnclosureSpec["feet"] =
    template === "wall_plate" || template === "stake_pod"
      ? "none"
      : template === "dome_base"
        ? "ring"
        : s.desk && !s.handheld && !s.wearable
          ? "rubber_4"
          : "none";
  let vents = base.vents;
  if (template === "lantern") vents = { pattern: "slots", face: "+x", count: 6 };
  else if (template === "dome_base" && s.speaker) vents = { pattern: "grille", face: "+z", count: 9 };
  else if (template === "stake_pod") vents = s.outdoor || s.plant ? { pattern: "louvres", face: "+x", count: 4 } : { pattern: "none", face: "-z", count: 0 };
  else if (base.template === "lantern" || base.template === "stake_pod" || vents.pattern === "grille") vents = { pattern: "none", face: "-z", count: 0 };
  const next: EnclosureSpec = {
    ...base,
    template,
    proportions: { widthToDepth, heightBias },
    feet,
    vents,
    cornerRadius: template === "wall_plate" ? Math.max(8, base.cornerRadius) : base.cornerRadius,
    lid: base.lid === "twist" && template !== "puck" ? "snap" : base.lid,
  };
  return clampEnclosure(next, [], {});
}

/** A complete, valid EnclosureSpec for a product — used when the AI answer is unusable. */
export function defaultEnclosureFor(spec: ProductSpec): EnclosureSpec {
  const template = templateFor(spec);
  const base: EnclosureSpec = { ...DEFAULT_ENCLOSURE, ...(spec.environment === "outdoor" ? { wall: 2.4 } : {}) };
  const out = adaptEnclosure(base, template, spec);
  if (template === "wall_plate") out.cornerRadius = 8;
  if (template === "puck" || template === "wall_plate" || spec.use === "wall") out.proportions.heightBias = "low";
  else if (template !== "lantern") out.proportions.heightBias = "mid";
  return out;
}

/**
 * "Other shapes": the next `n` best templates that differ from the current one (and from
 * each other), each adapted from the current look. First = the best alternative.
 */
export function shapeVariants(spec: ProductSpec, current: EnclosureSpec, n = 3): EnclosureSpec[] {
  return rankShapes(spec)
    .filter((r) => r.template !== current.template)
    .slice(0, n)
    .map((r) => adaptEnclosure(current, r.template, spec));
}

/**
 * The first look follows a strong rule: when there is no earlier look and the best rule
 * scores ≥ STRONG_SCORE, a model answer with another template is adapted to it (a plant
 * idea keeps a pot-friendly shape the model chose; a box becomes a stake pod). Later looks
 * ("Try another") are left as the model chose them.
 */
export function applyShapePick(value: EnclosureSpec, spec: ProductSpec, previous: readonly EnclosureSpec[]): EnclosureSpec {
  if (previous.length > 0) return value;
  const ranked = rankShapes(spec);
  const best = ranked[0];
  if (best.score < STRONG_SCORE || value.template === best.template) return value;
  if (best.reason === "plant" && POT_FRIENDLY.includes(value.template)) return value;
  // The model's pick is fine when the rules rate it almost as high.
  const theirs = ranked.find((r) => r.template === value.template);
  if (theirs && theirs.score >= STRONG_SCORE && best.score - theirs.score <= 10) return value;
  return adaptEnclosure(value, best.template, spec);
}
