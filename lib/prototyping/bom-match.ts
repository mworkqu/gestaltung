// The deterministic BOM matcher. Pure — the same catalogue and the same line
// always give the same answer, and every step can be explained:
//
//  1. Kind gate. A product whose category (or tags) clearly belong to another
//     kind is out — a fastener never matches "main controller".
//  2. Hard attributes. A voltage ("5V") or metric size ("M3") in the spec must
//     not contradict one on the product. No contradiction = allowed.
//  3. Score. Words of the line's FUNCTION found in the product (name, tags,
//     category, description, material, standard) score 2 each, words of the
//     SPEC 1 each. At least one function word must be present, so a product
//     never matches on "5V" alone.
//  4. Keep products within 75 % of the best score, at most three, ranked in
//     stock first, then by price. One left = a clear match; several = the
//     client chooses; none = not stocked.
//
// Every product field comes from public.parts. Nothing is invented here.

import type { BomKind, BomLine } from "./analysis";
import type { Candidate, LineMatch } from "./bom";

export type InventoryRow = { productId: string | null; customName: string | null; quantity: number };

const MAX_CANDIDATES = 3;
const KEEP_WITHIN = 0.75;

// Category words that place a product in one kind. A product in none of these
// is kind-neutral and may match any line.
const KIND_WORDS: Record<BomKind, RegExp> = {
  electronics:
    /electr|module|sensor|motor|servo|battery|batteries|power|board|pcb|cable|wire|connector|led|switch|relay|display|microcontroller|arduino|charger|solar|radio|antenna|إلكترون|حساس|محرك|بطارية/i,
  mechanical:
    /fasten|screw|nut|washer|bolt|rivet|bearing|spring|bracket|hinge|profile|extrusion|shaft|gear|pulley|clip|stand|mount|براغي|صامول|مسمار|حامل/i,
  consumable:
    /adhesive|glue|tape|filament|resin|solder|flux|lubric|grease|paint|sealant|consumable|لاصق|شريط|غراء/i,
};

const STOP = new Set(
  "a an and or the of for to in on with without per each unit units must be is at least more than or better standard size type min max".split(
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
const METRIC = /\bm(\d{1,2})\b/gi;

const all = (re: RegExp, s: string) => new Set([...s.matchAll(re)].map((m) => m[1]));

/** True when a stated attribute on each side exists and none agree. */
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

/** Score one text against a line; 0 = not a match. */
export function scoreText(line: Pick<BomLine, "function" | "spec">, text: string): number {
  const have = new Set(tokens(text));
  const fnHits = tokens(line.function).filter((w) => have.has(w)).length;
  if (!fnHits) return 0;
  const specHits = tokens(line.spec).filter((w) => have.has(w)).length;
  const lower = text.toLowerCase();
  const spec = `${line.function} ${line.spec}`.toLowerCase();
  if (contradicts(all(VOLT, spec), all(VOLT, lower))) return 0;
  if (contradicts(all(METRIC, spec), all(METRIC, lower))) return 0;
  return fnHits * 2 + specHits;
}

const STOCK_ORDER: Record<string, number> = { in_stock: 0, low_stock: 1, out_of_stock: 2 };

export function matchLine(
  line: BomLine & { choice?: string | null },
  catalogue: Candidate[],
  inventory: InventoryRow[],
  inventoryNames: Map<string, string>
): LineMatch {
  const scored = catalogue
    .filter((p) => {
      const k = productKind(p);
      return !k || k === line.kind;
    })
    .map((p) => ({ p, score: scoreText(line, productText(p)) }))
    .filter((x) => x.score > 0);

  const top = Math.max(0, ...scored.map((x) => x.score));
  const candidates = scored
    .filter((x) => x.score >= top * KEEP_WITHIN)
    .sort(
      (a, b) =>
        (STOCK_ORDER[a.p.stock_status] ?? 3) - (STOCK_ORDER[b.p.stock_status] ?? 3) ||
        Number(a.p.unit_price) - Number(b.p.unit_price)
    )
    .slice(0, MAX_CANDIDATES)
    .map((x) => x.p);

  // The client's own pick wins while it is still a candidate.
  const chosen = line.choice ? candidates.find((c) => c.id === line.choice) ?? null : null;
  const product = chosen ?? (candidates.length === 1 ? candidates[0] : null);

  // Already owned: the resolved product (or any candidate, before a pick) in
  // My Inventory, or a custom inventory item that matches the line itself.
  const ownedProduct = inventory.find(
    (i) => i.productId && i.quantity > 0 && (product ? i.productId === product.id : candidates.some((c) => c.id === i.productId))
  );
  const ownedCustom = inventory.find(
    (i) => i.customName && i.quantity > 0 && scoreText(line, i.customName) >= 2
  );
  const owned = ownedProduct ?? ownedCustom;
  const have = owned
    ? {
        name: owned.customName ?? inventoryNames.get(owned.productId!) ?? "",
        quantity: owned.quantity,
      }
    : null;

  const status = have
    ? "have"
    : candidates.length === 0
      ? "not_stocked"
      : product
        ? "matched"
        : "choose";
  return { lineId: line.id, status, candidates, product, have };
}
