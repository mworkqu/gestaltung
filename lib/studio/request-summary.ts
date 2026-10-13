// W2 (2026-10-11): what the "Request received" page (/[locale]/projects/[id]/request)
// shows after "Get it made": the project in plain words and a rough price range.
//
// Pure (no Supabase, no React): the page reads the StudioDoc + store prices and
// hands them here; the e2e fixture page does the same with a canned doc.
//
// Price rule (an ESTIMATE, labelled so on the page; an engineer confirms the
// real price on WhatsApp — never a promise):
//   known  = the store price of every part we sell × how many of it (Part D: identical
//            parts are one row with a quantity, "MG996R servo × 3"; pack price as listed)
//   print  = base + rate per gram × printed grams
//            (owner rule 2026-10-11: QAR 100 base + QAR 0.7 per gram of material)
//   low    = print + known, rounded down to QAR 10
//   high   = (print + known) × spread, rounded up to QAR 50
// The spread (default 1.5) covers the parts we still have to source, finishing
// and assembly. The usage-price rule (lib/pricing/usage-price.ts) is for
// per-use costs such as cloud CAD builds; none apply to a made product, so it
// is not part of this estimate.
//
// W2b (2026-10-11): quoteBreakdown() is the ONE calculation. The client page
// shows its range; /api/store-lead stores it (quoteCalcSnapshot) with the lead
// so the owner sees exactly how the number was made in the admin.

import type { Locale } from "./client/api";
import { MECH_NAMES } from "./mech/names";
import { groupComponents, withQuantity } from "./parts-group";
import type { LibraryPart, MechTemplate, StudioDoc } from "./schema";

export const ESTIMATE_SPREAD = 1.5;
export const PRINT_BASE_QAR = 100;
export const PRINT_QAR_PER_GRAM = 0.7;

/** Set on doc.answers when "Get it made" was sent (ISO time). */
export const REQUEST_SENT_KEY = "request:sent";

// The rule is data: store_settings.studio_quote_rule (migration 0073),
// editable by the owner in Dashboard → Leads → Quote accuracy. These code
// defaults are identical to the 0073 seed, so nothing changes before it runs.
export const QUOTE_RULE_KEY = "studio_quote_rule";
/** Bumped when the FORMULA changes (not the numbers); stored in each snapshot. */
export const QUOTE_RULE_VERSION = "2026-10-11";

export type QuoteRule = { base_qar: number; per_gram_qar: number; spread: number };
export const DEFAULT_QUOTE_RULE: QuoteRule = { base_qar: PRINT_BASE_QAR, per_gram_qar: PRINT_QAR_PER_GRAM, spread: ESTIMATE_SPREAD };
const RULE_KEYS: (keyof QuoteRule)[] = ["base_qar", "per_gram_qar", "spread"];

/** Owner-entered limits: anything outside is refused by the editor and ignored on read. */
export const QUOTE_RULE_LIMITS: Record<keyof QuoteRule, { min: number; max: number }> = {
  base_qar: { min: 0, max: 10000 },
  per_gram_qar: { min: 0, max: 100 },
  spread: { min: 1, max: 5 },
};

function inLimit(v: unknown, k: keyof QuoteRule): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  const { min, max } = QUOTE_RULE_LIMITS[k];
  return n >= min && n <= max ? n : null;
}

/** store_settings.studio_quote_rule (any shape) → a full rule; bad fields fall back to the defaults. */
export function parseQuoteRule(value: unknown): QuoteRule {
  const o = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    base_qar: inLimit(o.base_qar, "base_qar") ?? DEFAULT_QUOTE_RULE.base_qar,
    per_gram_qar: inLimit(o.per_gram_qar, "per_gram_qar") ?? DEFAULT_QUOTE_RULE.per_gram_qar,
    spread: inLimit(o.spread, "spread") ?? DEFAULT_QUOTE_RULE.spread,
  };
}

/** The editor's check: every field present and inside its limits (rounded to 2 dp), or the bad field names. */
export function validateQuoteRule(value: Record<string, unknown>): { ok: true; rule: QuoteRule } | { ok: false; bad: (keyof QuoteRule)[] } {
  const bad = RULE_KEYS.filter((k) => inLimit(value[k], k) === null);
  if (bad.length) return { ok: false, bad };
  const rule = Object.fromEntries(RULE_KEYS.map((k) => [k, money(inLimit(value[k], k)!)])) as QuoteRule;
  return { ok: true, rule };
}

export type PriceEstimate = { low: number; high: number };

const money = (n: number) => Math.round(n * 100) / 100;
const positive = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

/** Printing price: base + rate per gram of material (owner rule: QAR 100 + QAR 0.7/g). */
export function printPrice(grams: number, rule: QuoteRule = DEFAULT_QUOTE_RULE): number {
  return rule.base_qar + rule.per_gram_qar * positive(grams);
}

/** low = subtotal rounded down to QAR 10; high = subtotal × spread rounded up to QAR 50 (at least low + 50). */
export function rangeFor(subtotal: number, spread: number = ESTIMATE_SPREAD): PriceEstimate | null {
  if (!(subtotal > 0)) return null;
  const low = Math.max(10, Math.floor(subtotal / 10) * 10);
  const high = Math.max(low + 50, Math.ceil((subtotal * spread) / 50) * 50);
  return { low, high };
}

export function priceEstimate({ printedGrams, partsQar, rule = DEFAULT_QUOTE_RULE }: { printedGrams: number; partsQar: number; rule?: QuoteRule }): PriceEstimate | null {
  return rangeFor(printPrice(printedGrams, rule) + positive(partsQar), rule.spread);
}

// ── The breakdown ───────────────────────────────────────────────────────────

/** One row per template + material (the Print step's grouping). */
export type BreakdownPrinted = {
  template: string;
  name: string;
  name_ar: string;
  material: string;
  count: number;
  grams: number;
  /** grams × rate per gram */
  cost_qar: number;
};

export type BreakdownComponent = {
  /** The first instance id of the group. */
  id: string;
  name: string;
  name_ar: string;
  /** The store SKU we price it from, or null = "we source". */
  sku: string | null;
  /** The listed store price of ONE, or null when we have no price (we source it). */
  price_qar: number | null;
  /** Part D: how many of this part (identical parts are one row). Old snapshots: 1. */
  quantity: number;
};

export type QuoteBreakdown = {
  rule: QuoteRule;
  printed: BreakdownPrinted[];
  printedGrams: number;
  /** printedGrams × rate */
  gramsQar: number;
  /** base + gramsQar */
  printQar: number;
  components: BreakdownComponent[];
  /** Sum of the known store prices. */
  partsQar: number;
  /** printQar + partsQar */
  subtotalQar: number;
  estimate: PriceEstimate | null;
};

/**
 * The single price calculation. `prices` maps a store SKU to its listed QAR
 * price (published products only). A part counts as priced when its FIRST
 * linked SKU has a price.
 */
export function quoteBreakdown({
  doc,
  getPart,
  prices,
  rule = DEFAULT_QUOTE_RULE,
}: {
  doc: StudioDoc | null;
  getPart: (id: string) => LibraryPart | undefined;
  prices: ReadonlyMap<string, number>;
  rule?: QuoteRule;
}): QuoteBreakdown {
  const components: BreakdownComponent[] = [];
  let partsQar = 0;
  for (const g of groupComponents(doc?.components ?? [])) {
    const c = g.first;
    const lib = getPart(c.partId);
    const sku = lib?.storeSkus?.[0] ?? null;
    const price = sku ? prices.get(sku) : undefined;
    const priced = typeof price === "number" && Number.isFinite(price) && price > 0;
    if (priced) partsQar += price * g.quantity;
    components.push({
      id: c.instanceId,
      name: lib?.name.en ?? c.label,
      name_ar: lib?.name.ar ?? c.label,
      sku: priced ? sku : null,
      price_qar: priced ? money(price) : null,
      quantity: g.quantity,
    });
  }

  const rows = new Map<string, { template: string; material: string; count: number; grams: number }>();
  for (const m of doc?.mech ?? []) {
    const key = `${m.template}:${m.printable.material}`;
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      row.grams += m.printable.estGrams;
    } else rows.set(key, { template: m.template, material: m.printable.material, count: 1, grams: m.printable.estGrams });
  }
  const FIRST = ["base", "lid"];
  const rank = (r: { template: string }) => (FIRST.includes(r.template) ? FIRST.indexOf(r.template) : FIRST.length);
  const printed = [...rows.values()]
    .sort((a, b) => rank(a) - rank(b))
    .map((r): BreakdownPrinted => {
      const grams = Math.round(positive(r.grams));
      const names = MECH_NAMES[r.template as MechTemplate];
      return {
        template: r.template,
        name: names?.en ?? r.template,
        name_ar: names?.ar ?? r.template,
        material: r.material,
        count: r.count,
        grams,
        cost_qar: money(grams * rule.per_gram_qar),
      };
    });
  const printedGrams = printed.reduce((g, r) => g + r.grams, 0);
  const gramsQar = money(printedGrams * rule.per_gram_qar);
  const printQar = money(rule.base_qar + gramsQar);
  partsQar = money(partsQar);
  const subtotalQar = money(printQar + partsQar);
  return {
    rule,
    printed,
    printedGrams,
    gramsQar,
    printQar,
    components,
    partsQar,
    subtotalQar,
    estimate: rangeFor(subtotalQar, rule.spread),
  };
}

// ── The snapshot stored with the lead (inquiries.quote_calc) ───────────────

export type QuoteCalc = {
  v: 1;
  rule_version: string;
  /** "settings" = store_settings.studio_quote_rule, "default" = the code defaults. */
  rule_source: "settings" | "default";
  base_qar: number;
  per_gram_qar: number;
  spread: number;
  printed: BreakdownPrinted[];
  printed_grams: number;
  grams_qar: number;
  print_qar: number;
  components: BreakdownComponent[];
  parts_qar: number;
  subtotal_qar: number;
  low: number | null;
  high: number | null;
  midpoint: number | null;
  project_id: string | null;
  project_link: string | null;
  computed_at: string;
};

export function quoteCalcSnapshot(
  b: QuoteBreakdown,
  meta: { ruleSource: "settings" | "default"; projectId: string | null; projectLink: string | null; now?: Date },
): QuoteCalc {
  const e = b.estimate;
  return {
    v: 1,
    rule_version: QUOTE_RULE_VERSION,
    rule_source: meta.ruleSource,
    base_qar: b.rule.base_qar,
    per_gram_qar: b.rule.per_gram_qar,
    spread: b.rule.spread,
    printed: b.printed,
    printed_grams: b.printedGrams,
    grams_qar: b.gramsQar,
    print_qar: b.printQar,
    components: b.components,
    parts_qar: b.partsQar,
    subtotal_qar: b.subtotalQar,
    low: e?.low ?? null,
    high: e?.high ?? null,
    midpoint: e ? (e.low + e.high) / 2 : null,
    project_id: meta.projectId,
    project_link: meta.projectLink,
    computed_at: (meta.now ?? new Date()).toISOString(),
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** inquiries.quote_calc (jsonb, any shape) → a snapshot the admin can show, or null. Never throws. */
export function parseQuoteCalc(value: unknown): QuoteCalc | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  const base = num(o.base_qar);
  const rate = num(o.per_gram_qar);
  const spread = num(o.spread);
  const subtotal = num(o.subtotal_qar);
  if (base === null || rate === null || spread === null || subtotal === null) return null;
  const printed = (Array.isArray(o.printed) ? o.printed : []).flatMap((x): BreakdownPrinted[] => {
    const r = (x ?? {}) as Record<string, unknown>;
    const grams = num(r.grams);
    if (grams === null) return [];
    return [
      {
        template: str(r.template) ?? "",
        name: str(r.name) ?? str(r.template) ?? "",
        name_ar: str(r.name_ar) ?? str(r.name) ?? "",
        material: str(r.material) ?? "",
        count: num(r.count) ?? 1,
        grams,
        cost_qar: num(r.cost_qar) ?? money(grams * rate),
      },
    ];
  });
  const components = (Array.isArray(o.components) ? o.components : []).map((x): BreakdownComponent => {
    const r = (x ?? {}) as Record<string, unknown>;
    return {
      id: str(r.id) ?? "",
      name: str(r.name) ?? "",
      name_ar: str(r.name_ar) ?? str(r.name) ?? "",
      sku: str(r.sku),
      price_qar: num(r.price_qar),
      quantity: Math.max(1, Math.round(num(r.quantity) ?? 1)),
    };
  });
  const low = num(o.low);
  const high = num(o.high);
  return {
    v: 1,
    rule_version: str(o.rule_version) ?? "",
    rule_source: o.rule_source === "settings" ? "settings" : "default",
    base_qar: base,
    per_gram_qar: rate,
    spread,
    printed,
    printed_grams: num(o.printed_grams) ?? printed.reduce((g, r) => g + r.grams, 0),
    grams_qar: num(o.grams_qar) ?? 0,
    print_qar: num(o.print_qar) ?? base,
    components,
    parts_qar: num(o.parts_qar) ?? 0,
    subtotal_qar: subtotal,
    low,
    high,
    midpoint: num(o.midpoint) ?? (low !== null && high !== null ? (low + high) / 2 : null),
    project_id: str(o.project_id),
    project_link: str(o.project_link),
    computed_at: str(o.computed_at) ?? "",
  };
}

/** The owner's quote against the estimate: QAR difference and % of the midpoint (null when no estimate). */
export function quoteDifference(finalQar: number, calc: Pick<QuoteCalc, "midpoint">): { qar: number; pct: number } | null {
  if (!Number.isFinite(finalQar) || calc.midpoint === null || !(calc.midpoint > 0)) return null;
  const qar = money(finalQar - calc.midpoint);
  return { qar, pct: Math.round((qar / calc.midpoint) * 1000) / 10 };
}

/** The owner's typed quote ("1,250" / "1250.5" / Arabic digits) → QAR with 2 decimals, or null when invalid. */
export function parseFinalQuote(raw: unknown): number | null {
  const s = String(raw ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,\s٬]/g, "")
    .replace(/٫/g, ".")
    .trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? money(n) : null;
}

// ── The client page summary ────────────────────────────────────────────────

/** `name` already carries the quantity ("MG996R servo × 3"). */
export type SummaryPart = { id: string; name: string; priced: boolean; quantity: number };
export type SummaryPrinted = { template: string; material: string; count: number; grams: number };

export type RequestSummary = {
  name: string;
  oneLine: string;
  parts: SummaryPart[];
  printed: SummaryPrinted[];
  printedGrams: number;
  enclosure: { template: string; colour: string; finish: string } | null;
  partsQar: number;
  estimate: PriceEstimate | null;
  requestedAt: string | null;
};

export function requestSummary({
  doc,
  projectName,
  getPart,
  locale,
  prices,
  rule = DEFAULT_QUOTE_RULE,
}: {
  doc: StudioDoc | null;
  projectName: string;
  getPart: (id: string) => LibraryPart | undefined;
  locale: Locale;
  prices: ReadonlyMap<string, number>;
  rule?: QuoteRule;
}): RequestSummary {
  const b = quoteBreakdown({ doc, getPart, prices, rule });
  const e = doc?.enclosure ?? null;
  const sent = doc?.answers?.[REQUEST_SENT_KEY];
  return {
    name: (doc?.spec.name || projectName || "").trim(),
    oneLine: (doc?.spec.oneLine ?? "").trim(),
    parts: b.components.map((c) => ({
      id: c.id,
      name: withQuantity(locale === "ar" ? c.name_ar : c.name, c.quantity),
      priced: c.price_qar !== null,
      quantity: c.quantity,
    })),
    printed: b.printed.map((r) => ({ template: r.template, material: r.material, count: r.count, grams: r.grams })),
    printedGrams: b.printedGrams,
    enclosure: e ? { template: e.template, colour: e.colour, finish: e.finish } : null,
    partsQar: b.partsQar,
    estimate: b.estimate,
    requestedAt: typeof sent === "string" && sent ? sent : null,
  };
}
