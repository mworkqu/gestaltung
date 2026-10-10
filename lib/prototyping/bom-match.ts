// The deterministic BOM matcher. Pure — the same catalogue and the same line
// always give the same answer, and every candidate carries the reasons.
//
// Attributes first (lib/store/attributes). Since P5-01 both sides are typed
// even when nobody filled the attributes in: a product's class and values are
// read from its name (lib/store/derive-attributes effectiveAttributes; the
// owner's own attributes always win) and a line's from its function + spec
// (lineAttributes; a resistor value goes to the nearest E12 value). When both
// carry the same class every attribute the line asks for is compared: a
// contradiction excludes the product; so does a CORE field (sensor kind,
// module type …) the product does not state — a PIR line only takes PIR
// sensors. All known and agreeing is a STRONG match; some unknown is WEAK. A
// product of another class is excluded (a limit switch is no motion sensor).
//
// Text second, only for products whose name names no class, and never for a
// line that states a core type. It needs most of the line's function words in
// the product NAME, a voltage or M-size must not contradict, and a text match
// is always WEAK.
//
// A line resolves to a product on its own only when the best candidate is
// STRONG and not doubtful (several strong: the best ranked; alternatives stay
// one click away). Weak matches are never pre-selected: the client reads
// "We'll pick this part for you", super_admin sees the chooser. Duplicate
// listings of the same product collapse to one.
//
// Every product field comes from public.parts. Nothing is invented here.

import type { BomKind, BomLine } from "./analysis";
import { buyable, orderQty, packOf, type Candidate, type LineMatch, type ProjectLine, type ScoredCandidate, type Strength } from "./bom";
import { compareField, fieldsOf, hasValue, isAttrClass, type AttrClass, type Attributes } from "@/lib/store/attributes";
import { CORE_KEYS, effectiveAttributes, lineAttributes } from "@/lib/store/derive-attributes";
import { guardAccessory, guardText, headOf } from "./bom-intent";
import type { PackProduct } from "@/lib/store/pack";

export type InventoryRow = {
  productId: string | null;
  customName: string | null;
  quantity: number;
  attributes?: Attributes | null;
};

const MAX_CANDIDATES = 3;

// Category words that place an unattributed product in one kind.
const KIND_WORDS: Record<BomKind, RegExp> = {
  electronics:
    /electr|module|sensor|motor|servo|battery|batteries|power|board|pcb|cable|wire|connector|led|switch|relay|display|microcontroller|arduino|charger|solar|radio|antenna|resistor|capacitor|diode|transistor|إلكترون|حساس|محرك|بطارية/i,
  mechanical:
    /fasten|screw|nut|washer|bolt|rivet|bearing|spring|bracket|hinge|profile|extrusion|shaft|gear|pulley|clip|stand|mount|براغي|صامول|مسمار|حامل/i,
  consumable:
    /adhesive|glue|tape|filament|resin|solder|flux|lubric|grease|paint|sealant|consumable|لاصق|شريط|غراء/i,
};

const STOP = new Set(
  "a an and or the of for to in on with without per each unit units must be is at least more than or better standard size type min max from into that this which it its".split(
    " "
  )
);
// Words that describe what something does, not what it is. They never count
// towards a text match on their own.
const GENERIC = new Set(
  "component components part parts item items device devices system electrical electronic together secures secure stores store generates generate measures measure provides provide holds hold used use make makes keep keeps sensor-free general purpose high low quality resistant rated suitable outdoor indoor small large".split(
    " "
  )
);

/** Lower-case word tokens; keeps unit tokens like "5v", "m3", "12mm". */
export function tokens(s: string): string[] {
  return (s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}.]+/gu) ?? [])
    .map((w) => w.replace(/^\.+|\.+$/g, ""))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

const VOLT = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s?v(?:olt|dc|ac)?\b/gi;
const METRIC = /\bm(\d{1,2}(?:\.5)?)\b/gi;
const all = (re: RegExp, s: string) => new Set([...s.matchAll(re)].map((m) => m[1]));
const contradicts = (a: Set<string>, b: Set<string>) => a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));

function productKind(p: Candidate): BomKind | null {
  const text = `${p.category} ${(p.tags ?? []).join(" ")}`;
  const hits = (Object.keys(KIND_WORDS) as BomKind[]).filter((k) => KIND_WORDS[k].test(text));
  return hits.length === 1 ? hits[0] : null;
}

const productText = (p: Candidate) =>
  [p.name, p.name_ar, p.category, (p.tags ?? []).join(" "), p.description, p.description_ar, p.material, p.standard]
    .filter(Boolean)
    .join(" ");

/**
 * Text score; 0 = not a match. Needs at least two thirds of the function's
 * meaningful words (so "Tempered Glass Panel" no longer matches "stores
 * energy from the solar panel" on the word "panel").
 */
export function scoreText(line: Pick<BomLine, "function" | "spec">, text: string): { score: number; why: string[] } {
  const have = new Set(tokens(text));
  const fn = [...new Set(tokens(line.function).filter((w) => !GENERIC.has(w)))];
  if (!fn.length) return { score: 0, why: [] };
  const hits = fn.filter((w) => have.has(w));
  if (hits.length < Math.ceil((fn.length * 2) / 3)) return { score: 0, why: [] };
  const specHits = [...new Set(tokens(line.spec))].filter((w) => !GENERIC.has(w) && have.has(w));
  const lower = text.toLowerCase();
  const spec = `${line.function} ${line.spec}`.toLowerCase();
  if (contradicts(all(VOLT, spec), all(VOLT, lower))) return { score: 0, why: [] };
  if (contradicts(all(METRIC, spec), all(METRIC, lower))) return { score: 0, why: [] };
  return {
    score: hits.length * 2 + specHits.length,
    why: [`text: ${[...hits, ...specHits].slice(0, 6).join(", ")}`],
  };
}

/**
 * True when none of the line's own words is in the product's name, category or
 * tags, i.e. the product only mentions it in its description ("breadboard
 * friendly" on a transistor, "for Arduino" on a shield).
 */
function describedOnly(line: BomLine, p: Candidate): boolean {
  const fn = [...new Set(tokens(line.function).filter((w) => !GENERIC.has(w)))];
  if (!fn.length) return false;
  const core = new Set(
    tokens(`${p.name.replace(/\b[\w:-]+[ -](?:friendly|compatible)\b/gi, " ")} ${p.category} ${(p.tags ?? []).join(" ")}`)
  );
  return !fn.some((w) => core.has(w));
}

type Scored = { p: Candidate; strength: Strength; score: number; why: string[]; doubt?: boolean; compared?: number };

const OHMS = /\b(\d+(?:\.\d+)?)\s?(?:([kKM])\b|([kKM])?\s?(?:ohms?|Ω))/g;
const FARADS = /\b(\d+(?:\.\d+)?)\s?([pnuµm]?)F\b/g;
const SCALE: Record<string, number> = { "": 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3, u: 1e-6, µ: 1e-6, n: 1e-9, p: 1e-12 };

/**
 * An untyped listing that states a different value ("Resistor 10K" for a
 * 330 Ω line) is not a candidate, even a weak one.
 */
function valueContradicts(line: BomLine, text: string): boolean {
  const want = line.attributes ?? {};
  const target =
    line.class === "resistor" ? Number(want.resistance_ohm) : line.class === "capacitor" ? Number(want.capacitance_f) : NaN;
  if (!Number.isFinite(target) || target <= 0) return false;
  const re = line.class === "resistor" ? OHMS : FARADS;
  const found = [...text.matchAll(re)].map((m) => Number(m[1]) * SCALE[m[2] ?? m[3] ?? ""]);
  return found.length > 0 && !found.some((v) => Math.abs(v - target) <= target * 0.01);
}

/**
 * Attribute comparison of one product against what a line asks (`wanted`, from
 * lineAttributes). A contradiction excludes; so does a CORE field (what the
 * part IS: sensor kind, module type …) the product does not state. A min field
 * met exactly ranks above one met with room to spare (1 channel over 2).
 */
function scoreAttributes(cls: AttrClass, wanted: Attributes, attrs: Attributes, p: Candidate): Scored | null {
  const why: string[] = [];
  const core = CORE_KEYS[cls] ?? [];
  let known = 0;
  let unknown = 0;
  let exact = 0;
  for (const f of fieldsOf(cls)) {
    const want = wanted[f.key];
    if (want === undefined || want === null || want === "") continue;
    // A set ("M-M/M-F/F-F" jumpers) is never one product: one of its members is a weak match.
    if (f.key === "size" && typeof want === "string" && want.includes("/")) {
      const have = attrs.size;
      if (hasValue(have) && !want.toLowerCase().split("/").includes(String(have).toLowerCase()) && String(have).toLowerCase() !== want.toLowerCase())
        return null;
      unknown += 1;
      why.push(`size: part of the set ${want}`);
      continue;
    }
    const v = compareField(f, want, attrs);
    if (!v.ok) return null;
    if (!v.known && core.includes(f.key)) return null;
    why.push(v.why);
    if (v.known) {
      known += 1;
      if (f.compare === "min" && Math.abs(Number(attrs[f.key]) - Number(want)) < 1e-9) exact += 1;
    } else unknown += 1;
  }
  return {
    p,
    strength: unknown === 0 ? "strong" : "weak",
    score: 100 + known * 10 + exact * 2 - unknown,
    compared: known + unknown,
    why: [`class ${cls}`, ...why],
  };
}

// How well a product's head fits the line's own words, for ranking equals: +1
// per function word in the head ("ESP32 expansion shield" prefers the shield),
// −0.5 per head word the line never mentions ("Solid State", "Light Controlled").
const NOISE = new Set("module modules board sensor sensors kit pack pcs pieces piece mini small".split(" "));
function nameFit(line: Pick<BomLine, "function" | "spec">, p: Candidate): number {
  const said = new Set(tokens(`${line.function} ${line.spec}`));
  const fn = new Set(tokens(line.function).filter((w) => !GENERIC.has(w)));
  const head = tokens(headOf(p.name ?? ""));
  const hits = head.filter((w) => fn.has(w)).length;
  const extra = head.filter((w) => !/\d/.test(w) && !NOISE.has(w) && !said.has(w)).length;
  return hits - extra * 0.5;
}

// What each class is called in a shop. A typed line may match an untyped
// product on these ("status LED" → "LED Red 5mm"), always weakly, and never
// when a stated value contradicts.
const CLASS_WORDS: Record<string, RegExp> = {
  board: /\b(board|arduino|esp32|esp8266|raspberry|pico|stm32|microcontroller|mcu|uno|nano|mega)\b/i,
  module: /\b(module|driver|relay|display|lcd|oled|charger|regulator|shield)\b/i,
  ic: /\b(ic|chip|timer|op-?amp|amplifier)\b/i,
  sensor: /\b(sensor|probe|detector|dht\d*|hc-?sr\d*|thermistor)\b/i,
  actuator: /\b(motor|servo|stepper|pump|buzzer|solenoid|fan|vibration)\b/i,
  led: /\b(led|light emitting)\b/i,
  resistor: /\b(resistor|resistors)\b/i,
  capacitor: /\b(capacitor|cap)\b/i,
  diode: /\b(diode|rectifier|zener|schottky)\b/i,
  transistor: /\b(transistor|mosfet|npn|pnp)\b/i,
  switch: /\b(switch|button|tactile|toggle)\b/i,
  header: /\b(header|connector|terminal|jst|dupont|socket)\b/i,
  power: /\b(battery|batteries|holder|adapter|supply|psu|solar|charger|usb cable)\b/i,
  consumable: /\b(breadboard|jumper|perfboard|stripboard|wire|heat.?shrink|solder|tape|cable)\b/i,
  fastener: /\b(screw|bolt|nut|washer|standoff|spacer|rivet)\b/i,
};

// Some classes cover very different products, and the line's own attribute
// says which ("consumable" is a breadboard or heat-shrink, never both), so the
// attribute picks the words rather than the class.
const TYPE_WORDS: Record<string, Record<string, RegExp>> = {
  consumable: {
    breadboard: /\bbreadboard|solderless\b/i,
    jumper_wires: /\bjumper\b/i,
    perfboard: /\b(perfboard|strip ?board|proto ?board)\b/i,
    hookup_wire: /\b(hook-?up|awg|solid core)\b/i,
    heat_shrink: /\bheat.?shrink\b/i,
    solder: /\bsolder(?!less)\w*\b/i,
    usb_cable: /\busb\b/i,
    cable_ties: /\bcable tie\b/i,
    adhesive: /\b(glue|adhesive|epoxy)\b/i,
  },
  power: {
    battery: /\bbatter(y|ies)|cell\b/i,
    battery_holder: /\b(holder|clip|connector)\b/i,
    adapter: /\b(adapter|adaptor|power supply|psu)\b/i,
    solar_panel: /\bsolar\b/i,
    regulator: /\bregulator|buck|boost\b/i,
    charger: /\bcharger|charging\b/i,
    usb_cable: /\busb\b/i,
  },
};

/** The words an untyped product must contain to be even a weak candidate. */
function classWordsFor(line: BomLine): RegExp | null {
  if (!isAttrClass(line.class)) return null;
  const byType = TYPE_WORDS[line.class];
  if (byType) {
    const key = String(
      (line.attributes as Record<string, unknown> | undefined)?.[line.class === "consumable" ? "consumable_type" : "power_type"] ?? ""
    );
    return byType[key] ?? null;
  }
  return CLASS_WORDS[line.class] ?? null;
}

const STOCK_ORDER: Record<string, number> = { in_stock: 0, low_stock: 1, out_of_stock: 2 };
// What the storefront shows (lead_time_class, from supplier offers): sooner first,
// "available on request" (null) last. stock_status is legacy and only breaks ties.
const LEAD_ORDER: Record<string, number> = { in_stock: 0, "3_5_days": 1, "1_2_weeks": 2, "2_4_weeks": 3 };
const leadRank = (p: Candidate) => LEAD_ORDER[(p as { lead_time_class?: string | null }).lead_time_class ?? ""] ?? 4;

/** Same product listed twice (same name and price): keep the best-stocked one. */
function dedupe(list: Scored[]): Scored[] {
  const seen = new Map<string, Scored>();
  for (const s of list) {
    const k = `${s.p.name.trim().toLowerCase()}|${Number(s.p.unit_price)}|${s.p.pack_size ?? 1}`;
    const prev = seen.get(k);
    if (!prev || (STOCK_ORDER[s.p.stock_status] ?? 3) < (STOCK_ORDER[prev.p.stock_status] ?? 3)) seen.set(k, s);
  }
  return [...seen.values()];
}

export function matchLine(
  line: BomLine & { choice?: string | null },
  catalogue: Candidate[],
  inventory: InventoryRow[],
  inventoryNames: Map<string, string>
): LineMatch {
  // What the line asks for: its attributes, completed by its own words (P5-01).
  const wanted = lineAttributes(line);
  const lineClass = isAttrClass(wanted.class) ? wanted.class : null;
  const typedLine: BomLine = lineClass ? { ...line, class: lineClass, attributes: wanted } : line;
  // A line that says what the part IS (a PIR sensor, a relay module) only takes
  // products that say the same; a product of unknown type is never a stand-in.
  const needsType = !!lineClass && (CORE_KEYS[lineClass] ?? []).some((k) => hasValue(wanted[k]));

  const scored: Scored[] = [];
  for (const p of catalogue) {
    const eff = effectiveAttributes(p);
    let attrs = eff.attributes;
    // A USB cable is a USB cable whether the line files it under power or consumables.
    if (lineClass === "consumable" && attrs.class === "power" && attrs.power_type === "usb_cable")
      attrs = { class: "consumable", consumable_type: "usb_cable" };
    if (lineClass === "power" && attrs.class === "consumable" && attrs.consumable_type === "usb_cable")
      attrs = { class: "power", power_type: "usb_cable" };
    const cls = attrs.class;
    if (lineClass && isAttrClass(cls)) {
      // Both sides typed: attributes decide, text is not consulted.
      if (cls !== lineClass) continue;
      const s = scoreAttributes(lineClass, wanted, attrs, p);
      if (!s) continue;
      // A product named "Expansion Shield" is not the board the line asks for,
      // whatever class it carries.
      const acc = guardAccessory(typedLine, p);
      if (!acc.ok) continue;
      if (s.compared === 0 || eff.derived) {
        // A class read from the name (or a line that asks for no attribute) is
        // checked against the line's core noun too (bom-intent.ts).
        const g = guardText(typedLine, p);
        if (!g.ok) continue;
        const weakOnly = s.compared === 0;
        // "Same class" alone proves nothing (silicone tubing is no breadboard):
        // a line that asks for no attribute needs its own words in the name.
        if (weakOnly && scoreText(line, p.name ?? "").score === 0) continue;
        scored.push({
          ...s,
          strength: weakOnly ? "weak" : s.strength,
          score: s.score + g.bonus + nameFit(line, p),
          doubt: acc.doubt || g.doubt || undefined,
          why: [...s.why, ...(weakOnly ? ["line names no attribute"] : []), ...(eff.derived ? ["read from the name"] : []), ...g.why],
        });
        continue;
      }
      scored.push(acc.doubt ? { ...s, doubt: true, why: [...s.why, ...acc.why] } : s);
      continue;
    }
    if (needsType) continue;
    // Untyped product (or untyped line): text, and never better than weak.
    const k = productKind(p);
    if (k && k !== line.kind) continue;
    const text = productText(p);
    if (valueContradicts(typedLine, text)) continue;
    const t = scoreText(line, text);
    const byClass = classWordsFor(typedLine)?.test(text) ?? false;
    // A typed line needs the evidence in the product's NAME, not only in its
    // description (a soldering board "for resistors" is no resistor).
    if (lineClass && !(classWordsFor(typedLine)?.test(p.name) || scoreText(line, p.name).score > 0)) continue;
    if (t.score > 0 || byClass) {
      // Words are not enough: accessories, the core noun and fastener type/size
      // are checked against the product's name (lib/prototyping/bom-intent.ts).
      const g = guardText(typedLine, p);
      if (!g.ok) continue;
      const doubtful = g.doubt || describedOnly(line, p);
      scored.push({
        p,
        strength: "weak",
        score: (t.score || 1) + g.bonus,
        ...(doubtful ? { doubt: true } : {}),
        why: [
          isAttrClass(cls) ? "line has no attributes" : "product has no attributes",
          ...(t.why.length ? t.why : [`a ${lineClass ?? "part"} by its name`]),
          ...g.why,
          ...(!g.doubt && doubtful ? ["only its description mentions it"] : []),
        ],
      });
    }
  }

  // Price of what the client would actually pay: whole packs for the line's quantity.
  const cost = (p: Candidate) => Number(p.unit_price) * orderQty(line.quantity, p);
  const ranked = dedupe(scored).sort(
    (a, b) =>
      Number(b.strength === "strong") - Number(a.strength === "strong") ||
      Number(!!a.doubt) - Number(!!b.doubt) ||
      b.score - a.score ||
      leadRank(a.p) - leadRank(b.p) ||
      (STOCK_ORDER[a.p.stock_status] ?? 3) - (STOCK_ORDER[b.p.stock_status] ?? 3) ||
      cost(a.p) - cost(b.p)
  );
  const candidates: ScoredCandidate[] = ranked
    .slice(0, MAX_CANDIDATES)
    .map((s) => ({ ...s.p, strength: s.strength, why: s.why, ...(s.doubt ? { doubt: true } : {}) }));

  const strong = candidates.filter((c) => c.strength === "strong");
  // The client's own pick wins while it is still a candidate. Otherwise only a
  // CONFIDENT match is picked for them: the best candidate when it is strong and
  // not doubtful (owner, 2026-10-10: never pre-select a weak match). With
  // nothing confident the line is "choose": the client reads "We'll pick this
  // part for you", an engineer picks from the candidates.
  const chosen = line.choice ? candidates.find((c) => c.id === line.choice) ?? null : null;
  const top = candidates[0];
  const confident = top && top.strength === "strong" && !top.doubt ? top : null;
  const product = chosen ?? confident;
  const auto = !chosen && !!confident && strong.length > 1;

  const ownedProduct = inventory.find(
    (i) =>
      i.productId &&
      i.quantity > 0 &&
      (product ? i.productId === product.id : strong.some((c) => c.id === i.productId))
  );
  const ownedCustom = inventory.find((i) => {
    if (!i.customName || i.quantity <= 0) return false;
    const a = (i.attributes ?? {}) as Attributes;
    if (lineClass && a.class === lineClass) {
      const s = scoreAttributes(lineClass, wanted, a, { attributes: a } as Candidate);
      return s?.strength === "strong";
    }
    return scoreText(line, i.customName).score >= 4;
  });
  const owned = ownedProduct ?? ownedCustom;
  const have = owned
    ? { name: owned.customName ?? inventoryNames.get(owned.productId!) ?? "", quantity: owned.quantity }
    : null;

  const status = have ? "have" : candidates.length === 0 ? "not_stocked" : product ? "matched" : "choose";
  return { lineId: line.id, status, candidates, product, have, ...(auto ? { auto: true } : {}) };
}

/**
 * The best weak candidate of a line that has no strong one and no pick of the
 * client's: offered as "Suggested: … — confirm?", never shown as the line's
 * product. Null when the line resolved, is owned, or has a strong candidate.
 */
export function weakSuggestion(m: LineMatch | undefined): ScoredCandidate | null {
  if (!m || m.product || m.have || m.status !== "choose") return null;
  if (!m.candidates.length || m.candidates.some((c) => c.strength === "strong")) return null;
  return m.candidates[0];
}

/** Whole packs bring more pieces than the line needs ("need 1, sold in 100"). */
export const packExceedsNeed = (needed: number, p: PackProduct) =>
  packOf(p) > 1 && orderQty(needed, p) * packOf(p) > needed;

/**
 * Of the lines counted in "To buy now" (bomCost's availableNow: the buyable()
 * lines — resolved, not owned, not bought, in stock), how many are sold in
 * packs larger than the line needs.
 */
export function packLineCount(lines: ProjectLine[], matches: Map<string, LineMatch>): number {
  return lines.filter((l) => {
    const p = buyable(l, matches.get(l.id));
    return p ? packExceedsNeed(l.quantity, p) : false;
  }).length;
}
