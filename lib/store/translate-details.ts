// Arabic product descriptions + spec tables (Phase E1, 2026-10-03). Pure
// helpers for the admin-only "translate_details" step in
// app/api/admin/store-cleanup/route.ts: what to send, how to batch it, and
// how to read the model's answer back with per-product failure isolation.
//
// The source is exactly what /en renders (lib/store/product-details.ts), so
// specs_ar rows line up with the English rows one for one.

import { productDetailsForLocale, specRows, type ProductDetailsInput } from "@/lib/store/product-details";
import type { SpecRow } from "@/lib/store/specs";

/** Products per model call and characters per call. Sized so one call's
 *  Arabic answer stays well inside the free Flash-Lite model's output and a
 *  55 s timeout, and a few calls fit one 300 s Vercel function run. */
export const DETAILS_BATCH_ITEMS = 6;
export const DETAILS_BATCH_CHARS = 9_000;
/** A single description longer than this is cut at a paragraph break. */
export const DETAILS_MAX_DESCRIPTION = 6_000;

export type DetailsPart = ProductDetailsInput & { id: string; sku: string };

export type DetailsSource = {
  /** English text to translate, or null when nothing (or already Arabic). */
  description: string | null;
  /** English rows to translate ([] when none or already Arabic). */
  specs: SpecRow[];
  /** The product has no English spec rows at all → specs_ar is stored as []. */
  noSpecs: boolean;
};

export const DETAILS_SYSTEM_PROMPT = [
  "You translate product descriptions and specification tables for an electronics and maker store in Qatar into Modern Standard Arabic.",
  "Rules:",
  "- Keep part numbers, model names, brand names, chip and board names, protocols, units and values in Latin script exactly as written (e.g. ESP32, Arduino Uno, Raspberry Pi, 5V, 3.3V, I2C, SPI, PWM, USB-C, 10 kΩ, M3, mAh). Use Western digits 0-9.",
  '- Translate "sensor" as مستشعر (never حساس). Translate "kit" as مجموعة and "kits" as مجموعات.',
  "- Translate faithfully. Do not add, remove or strengthen any claim, feature, number, warranty or compatibility statement.",
  '- Leave out any "Links", "3D Model", "Tutorials", "Downloads" or similar boilerplate lines.',
  "- Keep the line structure: one output line per input line; a bullet line keeps its leading \"• \".",
  "- For every spec row translate the name; translate the words in the value but keep its numbers, units and part numbers unchanged. Return every row with its n.",
  "- Return every item with its index i. When an item has no description, return an empty description_ar.",
].join("\n");

export const DETAILS_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          i: { type: "INTEGER" },
          description_ar: { type: "STRING" },
          specs: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { n: { type: "INTEGER" }, name: { type: "STRING" }, value: { type: "STRING" } },
              required: ["n", "name", "value"],
            },
          },
        },
        required: ["i", "description_ar", "specs"],
      },
    },
  },
  required: ["items"],
};

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const at = head.lastIndexOf("\n\n");
  return (at > max / 2 ? head.slice(0, at) : head).trim();
}

/**
 * What to translate for one product. Without `force`, a description_ar or
 * specs_ar that is already filled is kept (only the missing half is sent).
 */
export function translationSource(part: DetailsPart, force = false): DetailsSource {
  const en = productDetailsForLocale(part, "en");
  const hasDescAr = !!(part.description_ar ?? "").trim();
  const hasSpecsAr = Array.isArray(part.specs_ar);
  const description = en.description && (force || !hasDescAr) ? cut(en.description, DETAILS_MAX_DESCRIPTION) : null;
  const specs = en.specs.length && (force || !hasSpecsAr || specRows(part.specs_ar).length === 0) ? en.specs : [];
  return { description, specs, noSpecs: en.specs.length === 0 };
}

export const sourceSize = (s: DetailsSource) =>
  (s.description?.length ?? 0) + s.specs.reduce((n, r) => n + r.name.length + r.value.length + 4, 0);

export const hasWork = (s: DetailsSource) => !!s.description || s.specs.length > 0;

/**
 * How many leading sources form the next batch: at most `maxItems` with work
 * and `maxChars` characters (always at least one). Sources with no work ride
 * along free, so the cursor moves past them.
 */
export function takeBatch(sources: DetailsSource[], maxItems = DETAILS_BATCH_ITEMS, maxChars = DETAILS_BATCH_CHARS): number {
  let items = 0;
  let chars = 0;
  let n = 0;
  for (const s of sources) {
    if (hasWork(s)) {
      const size = sourceSize(s);
      if (items > 0 && (items + 1 > maxItems || chars + size > maxChars)) break;
      items++;
      chars += size;
    }
    n++;
  }
  return n;
}

/** The user prompt: the batch as JSON, indexed. */
export function detailsPrompt(sources: DetailsSource[]): string {
  return JSON.stringify(
    sources.map((s, i) => ({
      i,
      description: s.description ?? "",
      specs: s.specs.map((r, n) => ({ n, name: r.name, value: r.value })),
    }))
  );
}

const ARABIC = /[؀-ۿ]/;
const toWesternDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
const digitsOf = (s: string) => s.replace(/[^0-9]/g, "");
const BOILERPLATE =
  /^[•\-*]?\s*(links?|useful links?|3d\s*models?|tutorials?|downloads?|روابط|الروابط|روابط مفيدة|نموذج ثلاثي الأبعاد|النموذج ثلاثي الأبعاد|نماذج ثلاثية الأبعاد|دروس|التنزيلات)\s*:?\s*$/i;

/** Model text → stored Arabic: Western digits, boilerplate lines dropped. */
export function cleanArabicText(text: string): string {
  return toWesternDigits(text)
    .split("\n")
    .filter((l) => !BOILERPLATE.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export type DetailsResult =
  | { ok: true; description_ar: string | null; specs_ar: SpecRow[] | null }
  | { ok: false; reason: string };

/**
 * Read the model's answer for a batch. One result per source, in order; a
 * product whose part of the answer is missing or invalid fails on its own.
 * description_ar / specs_ar are null when that half was not requested.
 */
export function parseDetailsTranslation(raw: unknown, sources: DetailsSource[]): DetailsResult[] {
  const items = Array.isArray((raw as { items?: unknown })?.items) ? ((raw as { items: unknown[] }).items as unknown[]) : [];
  const byIndex = new Map<number, Record<string, unknown>>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const i = (it as { i?: unknown }).i;
    if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < sources.length && !byIndex.has(i)) {
      byIndex.set(i, it as Record<string, unknown>);
    }
  }

  return sources.map((src, i): DetailsResult => {
    if (!hasWork(src)) return { ok: true, description_ar: null, specs_ar: null };
    const it = byIndex.get(i);
    if (!it) return { ok: false, reason: "missing_item" };

    let description_ar: string | null = null;
    if (src.description) {
      const text = typeof it.description_ar === "string" ? cleanArabicText(it.description_ar) : "";
      if (!text) return { ok: false, reason: "empty_description" };
      if (!ARABIC.test(text)) return { ok: false, reason: "description_not_arabic" };
      description_ar = text.slice(0, 12_000);
    }

    let specs_ar: SpecRow[] | null = null;
    if (src.specs.length) {
      const rows = Array.isArray(it.specs) ? (it.specs as unknown[]) : [];
      const byN = new Map<number, SpecRow>();
      for (const r of rows) {
        if (!r || typeof r !== "object") continue;
        const { n, name, value } = r as { n?: unknown; name?: unknown; value?: unknown };
        if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= src.specs.length || byN.has(n)) continue;
        if (typeof name !== "string" || typeof value !== "string") continue;
        const nm = toWesternDigits(name).trim();
        const val = toWesternDigits(value).trim();
        if (nm && val) byN.set(n, { name: nm.slice(0, 120), value: val.slice(0, 300) });
      }
      if (byN.size !== src.specs.length) return { ok: false, reason: "spec_rows_missing" };
      specs_ar = src.specs.map((_, n) => byN.get(n)!);
      // Values keep their numbers: a changed digit means a changed claim.
      if (specs_ar.some((r, n) => digitsOf(r.value) !== digitsOf(src.specs[n].value))) {
        return { ok: false, reason: "spec_value_changed" };
      }
      if (!specs_ar.some((r) => ARABIC.test(r.name))) return { ok: false, reason: "specs_not_arabic" };
    }

    return { ok: true, description_ar, specs_ar };
  });
}

/** The columns one product's update writes, or null when it failed. */
export function detailsUpdate(src: DetailsSource, result: DetailsResult, now: string) {
  if (!result.ok) return null;
  const update: { description_ar?: string; specs_ar?: SpecRow[]; details_ar_at: string } = { details_ar_at: now };
  if (result.description_ar) update.description_ar = result.description_ar;
  if (result.specs_ar) update.specs_ar = result.specs_ar;
  else if (src.noSpecs) update.specs_ar = [];
  return update;
}
