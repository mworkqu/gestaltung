// Store search ranking and sort orders (Phase C1/C2). Pure: the store page
// fetches the rows that match every search word (lib/store/catalog.ts builds
// that filter), ranks or sorts them here, then slices out one page.
//
// Relevance = title first, then category:
//   tier 3  the query is the product's SKU
//   tier 2  every query word is in the product name (EN or AR) as the subject
//   tier 1  some query word is in the name (or only in a "for ESP32" /
//           "(ESP32 compatible)" tail)
//   tier 0  matched elsewhere (SKU part, category, description)
// Within a tier: exact word > word prefix > substring, early words beat late
// ones, a name that starts with the query gets a bonus, then the category
// weight (boards and modules above wires and connectors), minus a penalty for
// accessory nouns ("jumper wire", "case") the shopper didn't ask for.

import { partName } from "@/lib/parts/format";

/** The fields ranking and sorting read. StoreCardPart satisfies it. */
export type SearchableProduct = {
  id: string;
  name: string;
  name_ar?: string | null;
  sku: string;
  category?: string | null;
  unit_price: number;
};

// ── Category weights ─────────────────────────────────────────────────────────
// Keyed by category name, matched after normalising case, "&"/"and" and
// spacing, so "Chips & ICs" and "Chips and ICs" are the same row. Holds the
// nine store categories (C5, 0048) and the older source categories (rows read
// before 0048); an unknown category gets DEFAULT_CATEGORY_WEIGHT, so a renamed
// category never breaks search.
export const CATEGORY_WEIGHTS: Record<string, number> = {
  // The nine store categories (parts.store_category).
  "Boards and microcontrollers": 4,
  Sensors: 3,
  Modules: 3,
  "Chips and ICs": 2.5,
  Power: 2,
  "Motors and mechanical": 2,
  "3D printing": 1.5,
  "Cables and connectors": 0,
  "Tools and accessories": 0,
  // Source categories (parts.category; not repeated above).
  "Raspberry Pi": 4,
  Microcontrollers: 4,
  Displays: 3,
  "3D printers": 3,
  Motors: 2.5,
  Kits: 2,
  Components: 1.5,
  "3D printing filament": 1.5,
  "3D printer parts": 1.5,
  Mechanical: 1,
  Fasteners: 1,
  Prototyping: 0.5,
  Tools: 0.5,
  Other: 0.5,
};
export const DEFAULT_CATEGORY_WEIGHT = 1;

const categoryKey = (c: string) =>
  c.toLowerCase().replace(/&/g, " and ").replace(/\s+/g, " ").trim();

const WEIGHTS_BY_KEY = new Map(Object.entries(CATEGORY_WEIGHTS).map(([k, v]) => [categoryKey(k), v]));

export function categoryWeight(category: string | null | undefined): number {
  if (!category?.trim()) return DEFAULT_CATEGORY_WEIGHT;
  return WEIGHTS_BY_KEY.get(categoryKey(category)) ?? DEFAULT_CATEGORY_WEIGHT;
}

// ── Text normalisation ───────────────────────────────────────────────────────

/** Lower-case, no Latin accents, Arabic without tashkeel/tatweel, one alef/ya/ta marbuta form, Western digits. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Distinct normalised words of a query. */
export function queryWords(query: string): string[] {
  return Array.from(new Set(normalizeText(query).match(WORD) ?? []));
}

const compact = (s: string) => (normalizeText(s).match(WORD) ?? []).join("");

/** A light stem so "sensors" = "sensor" and "الحساس" = "حساس". */
function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.startsWith("ال")) s = s.slice(2);
  if (s.length > 4 && s.endsWith("es")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s")) s = s.slice(0, -1);
  return s;
}

// Words after these (or anything in parentheses) describe what the product
// fits, not what it is: "2-pin jumper wire for ESP32", "Laser module (ESP32 compatible)".
const CONTEXT_MARKERS = new Set([
  "for", "compatible", "with", "fits", "fit", "supports", "suits", "works",
  "لـ", "ل", "مع", "متوافق", "متوافقه", "يناسب", "يدعم",
]);

// Accessory nouns: when the name is one of these and the query doesn't ask for
// it, the product drops below the real thing ("ESP32 case" under "ESP32").
const ACCESSORY_WORDS = new Set([
  "jumper", "wire", "cable", "connector", "header", "case", "enclosure",
  "holder", "adapter", "cover", "standoff", "sticker", "dupont",
  "سلك", "اسلاك", "كابل", "موصل", "علبه", "غطاء", "حامل",
]);

type NameToken = { token: string; context: boolean; index: number };

function nameTokens(name: string | null | undefined): NameToken[] {
  if (!name) return [];
  const out: NameToken[] = [];
  let depth = 0;
  let afterMarker = false;
  for (const m of normalizeText(name).matchAll(/[()[\]]|[\p{L}\p{N}]+/gu)) {
    const t = m[0];
    if (t === "(" || t === "[") depth++;
    else if (t === ")" || t === "]") depth = Math.max(0, depth - 1);
    else {
      if (CONTEXT_MARKERS.has(t)) afterMarker = true;
      out.push({ token: t, context: depth > 0 || afterMarker, index: out.length });
    }
  }
  return out;
}

/** 3 exact word, 2 word prefix, 1 substring, 0 none. */
function strength(word: string, token: string): number {
  if (token === word || stem(token) === stem(word)) return 3;
  if (word.length >= 2 && token.startsWith(word)) return 2;
  if (word.length >= 3 && token.includes(word)) return 1;
  return 0;
}

const CONTEXT_FACTOR = 0.4;

type WordHit = { value: number; subject: boolean; any: boolean };

function bestHit(word: string, tokens: NameToken[]): WordHit {
  let best: WordHit = { value: 0, subject: false, any: false };
  for (const t of tokens) {
    const s = strength(word, t.token);
    if (!s) continue;
    const value = t.context ? s * CONTEXT_FACTOR : s + (t.index === 0 ? 1 : t.index <= 2 ? 0.5 : 0);
    if (value > best.value) best = { value, subject: best.subject || !t.context, any: true };
    else best = { ...best, subject: best.subject || !t.context, any: true };
  }
  return best;
}

/** Relevance of one product for a query; higher is better, 0 = no signal at all. */
export function scoreProduct(query: string, product: SearchableProduct): number {
  const words = queryWords(query);
  if (!words.length) return 0;

  const en = nameTokens(product.name);
  const ar = nameTokens(product.name_ar);
  let title = 0;
  let allSubject = true;
  let anyTitle = false;
  for (const w of words) {
    const a = bestHit(w, en);
    const b = bestHit(w, ar);
    title += Math.max(a.value, b.value);
    if (!(a.subject || b.subject)) allSubject = false;
    if (a.any || b.any) anyTitle = true;
  }

  const q = compact(query);
  const sku = compact(product.sku);
  const skuExact = q.length > 0 && sku === q;

  let bonus = 0;
  if (q.length >= 2) {
    const names = [compact(product.name), compact(product.name_ar ?? "")].filter(Boolean);
    if (names.some((n) => n === q)) bonus += 5;
    else if (names.some((n) => n.startsWith(q))) bonus += 3;
    else if (q.length >= 3 && names.some((n) => n.includes(q))) bonus += 1.5;
    if (!skuExact && q.length >= 3 && sku.includes(q)) bonus += 1;
  }
  const cat = nameTokens(product.category);
  if (words.some((w) => cat.some((t) => strength(w, t.token) >= 2))) bonus += 1;

  const asked = new Set(words.map(stem));
  const accessory = en.some((t) => !t.context && ACCESSORY_WORDS.has(stem(t.token)) && !asked.has(stem(t.token)))
    || ar.some((t) => !t.context && ACCESSORY_WORDS.has(t.token) && !asked.has(stem(t.token)));

  const tier = skuExact ? 3 : allSubject ? 2 : anyTitle ? 1 : 0;
  return tier * 100 + title + bonus + categoryWeight(product.category) - (accessory ? 3 : 0);
}

// ── Sort orders ──────────────────────────────────────────────────────────────

const collators = new Map<string, Intl.Collator>();
function collator(locale: string): Intl.Collator {
  const key = locale === "ar" ? "ar" : "en";
  let c = collators.get(key);
  if (!c) {
    c = new Intl.Collator(key, { sensitivity: "base", numeric: true });
    collators.set(key, c);
  }
  return c;
}

const byId = (a: SearchableProduct, b: SearchableProduct) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Name A–Z by the name shown in this locale (Arabic name in /ar, falling back to English). */
export function compareByName(locale: string) {
  const c = collator(locale);
  return (a: SearchableProduct, b: SearchableProduct): number =>
    c.compare(partName({ name: a.name, name_ar: a.name_ar ?? null }, locale), partName({ name: b.name, name_ar: b.name_ar ?? null }, locale)) ||
    byId(a, b);
}

export function compareByPriceAsc(locale: string) {
  const name = compareByName(locale);
  return (a: SearchableProduct, b: SearchableProduct): number => a.unit_price - b.unit_price || name(a, b);
}

export function compareByPriceDesc(locale: string) {
  const name = compareByName(locale);
  return (a: SearchableProduct, b: SearchableProduct): number => b.unit_price - a.unit_price || name(a, b);
}

/** Best match first; ties by name. Returns a new array. */
export function rankProducts<T extends SearchableProduct>(query: string, products: readonly T[], locale = "en"): T[] {
  const name = compareByName(locale);
  return products
    .map((p) => ({ p, s: scoreProduct(query, p) }))
    .sort((a, b) => b.s - a.s || name(a.p, b.p))
    .map((x) => x.p);
}

export type ProductSort = "relevance" | "price_asc" | "price_desc" | "name";

/** One entry point for the store page. Relevance without a query = name A–Z. */
export function sortProducts<T extends SearchableProduct>(
  products: readonly T[],
  sort: ProductSort,
  query: string,
  locale: string
): T[] {
  if (sort === "relevance" && query.trim()) return rankProducts(query, products, locale);
  const cmp =
    sort === "price_asc" ? compareByPriceAsc(locale) : sort === "price_desc" ? compareByPriceDesc(locale) : compareByName(locale);
  return [...products].sort(cmp);
}
