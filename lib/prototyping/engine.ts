// The prototyping rules engine.
//
// This is what stands in for a model: deterministic keyword rules over the
// brief, with an explicit confidence on every output. It costs nothing to run,
// it never leaves the server, and it is honest about being a guess — the UI
// asks the client to confirm or correct every single thing it produces.
//
// It is PURE and returns message KEYS, not sentences. Gestaltung is bilingual,
// so the caller translates (Prototyping.claim_*, part_*, warn_*) and only then
// writes text to the database. Keeping prose out of here is also what makes
// the rules testable and what will let a real model replace this file behind
// the same return types.

import {
  isCompatible,
  PROCESS_LEAD_DAYS,
  processesFor,
  type Material,
  type Process,
  type SchematicKind,
} from "./constants";

export type Claim = {
  key: string;
  params?: Record<string, string | number>;
  confidence: number;
  isAssumption?: boolean;
};

export type SuggestedPart = {
  /** Message key under Prototyping.part_<key>_name / _desc. */
  key: string;
  quantity: number;
  material: Material;
  process: Process;
  confidence: number;
  kind: SchematicKind;
};

export type Analysis = { claims: Claim[]; parts: SuggestedPart[] };

// ── Feature detection ──────────────────────────────────────────────────────
// One regex per idea we can recognise. Anything we don't recognise simply
// doesn't fire, and the client fills the gap by hand — which is the honest
// failure mode for a keyword engine.

const FEATURES = {
  outdoor: /\b(outdoor|outside|public|street|park|kerb|curb|garden|rain|sun|weather)\b/i,
  heat: /\b(hot|heat|summer|thermal|50\s*°?\s*c|45\s*°?\s*c|doha|qatar|gulf)\b/i,
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

// ── Claims ─────────────────────────────────────────────────────────────────

export function readBrief(brief: string): Claim[] {
  const f = detect(brief);
  const claims: Claim[] = [];

  // No "this is the product described above" claim: the engine cannot write a
  // summary, and a confirm control for text nobody can see is worse than none.

  if (f.has("outdoor"))
    claims.push({ key: "outdoor", confidence: f.has("heat") ? 88 : 70 });
  if (f.has("heat"))
    claims.push({ key: "heat", confidence: 82 });
  if (f.has("washdown"))
    claims.push({ key: "washdown", confidence: 76 });

  if (f.has("power")) {
    const solar = /\bsolar|off-grid|offgrid\b/i.test(brief);
    claims.push({
      key: solar ? "solar" : "power",
      confidence: solar ? 78 : 55,
      isAssumption: !solar,
    });
  } else if (f.has("electronics")) {
    // Nothing in the brief says how it is powered, but it clearly needs to be.
    claims.push({ key: "power", confidence: 40, isAssumption: true });
  }

  if (f.has("electronics"))
    claims.push({ key: "electronics", confidence: 80 });

  const mass = firstQuantity(brief, /kg|g|grams?|kilograms?/);
  const volume = firstQuantity(brief, /l|litres?|liters?|ml/);
  if (mass || volume)
    claims.push({
      key: "capacity",
      params: { mass: mass ?? "—", volume: volume ?? "—" },
      confidence: 85,
    });

  const batch = batchSize(brief);
  if (batch)
    claims.push({ key: "batch", params: { count: batch }, confidence: 90 });
  else
    claims.push({ key: "batch_unknown", confidence: 30, isAssumption: true });

  if (f.has("security")) claims.push({ key: "security", confidence: 72 });
  if (f.has("mounting")) claims.push({ key: "mounting", confidence: 50, isAssumption: true });

  return claims;
}

/**
 * The wording of the retired "subject" claim, in both locales. Rows with this
 * text were written before it was removed; the workspace deletes them on load.
 */
export const LEGACY_SUBJECT_CLAIMS = [
  "This is the product described in the brief above — confirm the summary is right.",
  "هذا هو المنتج الموصوف أعلاه — أكّد أن الملخص صحيح.",
];

// ── Part breakdown ─────────────────────────────────────────────────────────
// Each rule contributes one part when its feature fires. The catch-all at the
// end means a brief we understood nothing from still produces something to
// edit rather than an empty screen.

type PartRule = {
  when: (f: Set<Feature>, brief: string) => boolean;
  part: Omit<SuggestedPart, "key"> & { key: string };
};

const PART_RULES: PartRule[] = [
  {
    when: (f) => f.has("enclosure") || f.has("outdoor"),
    part: { key: "enclosure", quantity: 1, material: "stainless_304", process: "laser_cutting", confidence: 82, kind: "flat_pattern" },
  },
  {
    when: (f, brief) => f.has("outdoor") && /\bsolar\b/i.test(brief),
    part: { key: "roof", quantity: 1, material: "aluminium_6061", process: "laser_cutting", confidence: 70, kind: "flat_pattern" },
  },
  {
    when: (f) => f.has("food"),
    part: { key: "dispenser", quantity: 1, material: "petg", process: "3d_printing", confidence: 74, kind: "outline" },
  },
  {
    when: (f) => f.has("water"),
    part: { key: "reservoir", quantity: 1, material: "petg", process: "3d_printing", confidence: 71, kind: "outline" },
  },
  {
    when: (f) => f.has("mounting") || f.has("enclosure"),
    part: { key: "bracket", quantity: 4, material: "aluminium_6061", process: "cnc_machining", confidence: 80, kind: "bracket" },
  },
  {
    when: (f) => f.has("electronics"),
    part: { key: "pcb", quantity: 1, material: "fr4", process: "pcb_manufacturing", confidence: 86, kind: "block_diagram" },
  },
  {
    when: (f) => f.has("precision") || f.has("moving"),
    part: { key: "coupling", quantity: 1, material: "stainless_304", process: "edm", confidence: 62, kind: "outline" },
  },
];

export function breakDown(brief: string): SuggestedPart[] {
  const f = detect(brief);
  const parts = PART_RULES.filter((r) => r.when(f, brief)).map((r) => r.part);
  if (parts.length) return parts;

  // Understood nothing: offer the two parts almost everything has.
  return [
    { key: "body", quantity: 1, material: "aluminium_6061", process: "cnc_machining", confidence: 30, kind: "outline" },
    { key: "plate", quantity: 1, material: "stainless_304", process: "laser_cutting", confidence: 30, kind: "flat_pattern" },
  ];
}

export const analyse = (brief: string): Analysis => ({
  claims: readBrief(brief),
  parts: breakDown(brief),
});

/**
 * Material + process for a part the client is adding by hand. Same rules, run
 * over the part's own name and description instead of the whole brief.
 */
export function suggestSpec(text: string): {
  material: Material;
  process: Process;
  confidence: number;
  reasonKey: string;
} {
  const t = text.toLowerCase();
  if (/\b(pcb|board|circuit|sensor|electronic|controller)\b/.test(t))
    return { material: "fr4", process: "pcb_manufacturing", confidence: 88, reasonKey: "electronics" };
  if (/\b(key|keyway|coupling|spline|gear|tolerance|precision)\b/.test(t))
    return { material: "stainless_304", process: "edm", confidence: 68, reasonKey: "precision" };
  if (/\b(lid|hatch|door|panel|cover|shell|sheet|plate|bracket|frame)\b/.test(t))
    return { material: "stainless_304", process: "laser_cutting", confidence: 78, reasonKey: "sheet" };
  if (/\b(housing|bowl|clip|knob|cap|funnel|seal|gasket|spacer|mount)\b/.test(t))
    return { material: "petg", process: "3d_printing", confidence: 72, reasonKey: "shaped" };
  return { material: "aluminium_6061", process: "cnc_machining", confidence: 45, reasonKey: "generic" };
}

// ── Manufacturing recommendation ───────────────────────────────────────────

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
  leadDays: number;
  /** Same material throughout, so the parts can be batched together. */
  nestable: boolean;
};

export type Recommendation = {
  routes: Route[];
  warnings: Warning[];
  criticalPath: Process | null;
  leadDays: number;
  confidence: number;
};

export function recommend(parts: PartLike[], brief = ""): Recommendation {
  const hot = FEATURES.heat.test(brief) || FEATURES.outdoor.test(brief);
  const wet = FEATURES.washdown.test(brief) || FEATURES.water.test(brief);

  const byProcess = new Map<Process, PartLike[]>();
  for (const p of parts) {
    if (!p.process) continue;
    const list = byProcess.get(p.process as Process) ?? [];
    list.push(p);
    byProcess.set(p.process as Process, list);
  }

  const routes: Route[] = [...byProcess.entries()]
    .map(([process, list]) => ({
      process,
      parts: list,
      leadDays: PROCESS_LEAD_DAYS[process],
      nestable: list.length > 1 && new Set(list.map((p) => p.material)).size === 1,
    }))
    .sort((a, b) => b.leadDays - a.leadDays);

  const warnings: Warning[] = [];
  for (const p of parts) {
    const params = { code: p.code, name: p.name };
    if (!p.material || !p.process) {
      warnings.push({ key: "unset", params, blocking: true });
      continue;
    }
    if (!isCompatible(p.material, p.process)) {
      const alt = processesFor(p.material);
      warnings.push({
        key: "incompatible",
        params: { ...params, material: p.material, process: p.process, alt: alt.join(",") },
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

  const critical = routes[0]?.process ?? null;
  const confidence = Math.max(
    25,
    92 - warnings.filter((w) => w.blocking).length * 25 - warnings.filter((w) => !w.blocking).length * 12
  );

  return {
    routes,
    warnings,
    criticalPath: critical,
    leadDays: critical ? PROCESS_LEAD_DAYS[critical] : 0,
    confidence,
  };
}
