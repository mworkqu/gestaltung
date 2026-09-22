// The deterministic BOM matcher. Pure — the same catalogue and the same line
// always give the same answer, and every candidate carries the reasons.
//
// Attributes first (lib/store/attributes). When the line names a class and a
// product carries the same class, every attribute the line asks for is
// compared: a contradiction excludes the product; all known and agreeing is a
// STRONG match; some unknown on the product is a WEAK match ("no power rating
// on product"). A product of another class is excluded.
//
// Text second, only for products with no class, or lines with none. It needs
// most of the line's function words in the product (not one stray word), a
// voltage or M-size must not contradict, and a text match is always WEAK.
//
// A line resolves to a product on its own only when exactly one distinct
// STRONG match exists. Weak matches are shown and labelled, never picked for
// the client. Duplicate listings of the same product collapse to one.
//
// Every product field comes from public.parts. Nothing is invented here.

import type { BomKind, BomLine } from "./analysis";
import type { Candidate, LineMatch, ScoredCandidate, Strength } from "./bom";
import { compareField, fieldsOf, isAttrClass, type Attributes } from "@/lib/store/attributes";

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

type Scored = { p: Candidate; strength: Strength; score: number; why: string[] };

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

/** Attribute comparison of one product against a line that names a class. */
function scoreAttributes(line: BomLine, p: Candidate): Scored | null {
  const attrs = (p.attributes ?? {}) as Attributes;
  if (!isAttrClass(line.class)) return null;
  const wanted = (line.attributes ?? {}) as Record<string, unknown>;
  const why: string[] = [];
  let known = 0;
  let unknown = 0;
  for (const f of fieldsOf(line.class)) {
    if (!(f.key in wanted) || wanted[f.key] === null || wanted[f.key] === "") continue;
    const v = compareField(f, wanted[f.key], attrs);
    if (!v.ok) return null;
    why.push(v.why);
    if (v.known) known += 1;
    else unknown += 1;
  }
  return {
    p,
    strength: unknown === 0 ? "strong" : "weak",
    score: 100 + known * 10 - unknown,
    why: [`class ${line.class}`, ...why],
  };
}

const STOCK_ORDER: Record<string, number> = { in_stock: 0, low_stock: 1, out_of_stock: 2 };

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
  const scored: Scored[] = [];
  for (const p of catalogue) {
    const cls = (p.attributes as Attributes | null | undefined)?.class;
    if (isAttrClass(line.class) && isAttrClass(cls)) {
      // Both sides typed: attributes decide, text is not consulted.
      if (cls !== line.class) continue;
      const s = scoreAttributes(line, p);
      if (s) scored.push(s);
      continue;
    }
    // Untyped product (or untyped line): text, and never better than weak.
    const k = productKind(p);
    if (k && k !== line.kind) continue;
    if (valueContradicts(line, productText(p))) continue;
    const t = scoreText(line, productText(p));
    if (t.score > 0)
      scored.push({
        p,
        strength: "weak",
        score: t.score,
        why: [isAttrClass(cls) ? "line has no attributes" : "product has no attributes", ...t.why],
      });
  }

  const ranked = dedupe(scored).sort(
    (a, b) =>
      Number(b.strength === "strong") - Number(a.strength === "strong") ||
      b.score - a.score ||
      (STOCK_ORDER[a.p.stock_status] ?? 3) - (STOCK_ORDER[b.p.stock_status] ?? 3) ||
      Number(a.p.unit_price) - Number(b.p.unit_price)
  );
  const candidates: ScoredCandidate[] = ranked
    .slice(0, MAX_CANDIDATES)
    .map((s) => ({ ...s.p, strength: s.strength, why: s.why }));

  const strong = candidates.filter((c) => c.strength === "strong");
  // The client's own pick wins while it is still a candidate; otherwise only a
  // single strong match resolves the line by itself.
  const chosen = line.choice ? candidates.find((c) => c.id === line.choice) ?? null : null;
  const product = chosen ?? (strong.length === 1 ? strong[0] : null);

  const ownedProduct = inventory.find(
    (i) =>
      i.productId &&
      i.quantity > 0 &&
      (product ? i.productId === product.id : strong.some((c) => c.id === i.productId))
  );
  const ownedCustom = inventory.find((i) => {
    if (!i.customName || i.quantity <= 0) return false;
    const a = (i.attributes ?? {}) as Attributes;
    if (isAttrClass(line.class) && a.class === line.class) {
      const s = scoreAttributes(line, { attributes: a } as Candidate);
      return s?.strength === "strong";
    }
    return scoreText(line, i.customName).score >= 4;
  });
  const owned = ownedProduct ?? ownedCustom;
  const have = owned
    ? { name: owned.customName ?? inventoryNames.get(owned.productId!) ?? "", quantity: owned.quantity }
    : null;

  const status = have ? "have" : candidates.length === 0 ? "not_stocked" : product ? "matched" : "choose";
  return { lineId: line.id, status, candidates, product, have };
}
