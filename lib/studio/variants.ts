// Part colours (owner, 2026-10-18): "Green, yellow, and red LEDs × 3" on the card
// means one green, one yellow and one red LED — each its own store listing and
// drawn in its own colour on the parts plate. Pure.
//
// StudioComponent.variant holds the colour; the library part stays one id
// (led_5mm) so the wiring, layout and checks are unchanged. VARIANT_SKUS maps a
// part's colour to the store listing of that colour (live catalogue, 2026-10-18).

import type { LibraryPart } from "./schema";

export const PART_COLOURS = {
  red: { hex: "#ff3b30", en: "Red", ar: "أحمر", re: /\bred\b|أحمر|حمراء/i },
  green: { hex: "#34c759", en: "Green", ar: "أخضر", re: /\bgreen\b|أخضر|خضراء/i },
  yellow: { hex: "#ffcc00", en: "Yellow", ar: "أصفر", re: /\byellow\b|أصفر|صفراء/i },
  blue: { hex: "#0a84ff", en: "Blue", ar: "أزرق", re: /\bblue\b|أزرق|زرقاء/i },
  orange: { hex: "#ff9500", en: "Orange", ar: "برتقالي", re: /\borange\b|برتقالي/i },
  white: { hex: "#f2f2f7", en: "White", ar: "أبيض", re: /\bwhite\b|\bclear\b|أبيض|بيضاء/i },
} as const;
export type PartColour = keyof typeof PART_COLOURS;
export const isPartColour = (v: unknown): v is PartColour => typeof v === "string" && v in PART_COLOURS;

/** Store listing per colour, for parts sold in colours. */
export const VARIANT_SKUS: Record<string, Partial<Record<PartColour, string>>> = {
  led_5mm: {
    red: "VLT-12363645747302",
    green: "VLT-12363594203238",
    yellow: "VLT-12363649286246",
    blue: "VLT-12363652104294",
    orange: "VLT-44640376488253",
    white: "VLT-12363655512166",
  },
};

export const hasVariants = (partId: string) => partId in VARIANT_SKUS;

/** Colours named in a text, in the order they are written ("green, yellow and red"). */
export function coloursIn(text: string): PartColour[] {
  const hits: { c: PartColour; at: number }[] = [];
  for (const [c, v] of Object.entries(PART_COLOURS) as [PartColour, (typeof PART_COLOURS)[PartColour]][]) {
    const m = v.re.exec(text);
    if (m) hits.push({ c, at: m.index });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.c);
}

/** The SKUs to try for a component: its colour's listing first, then the part's own. */
export function skusFor(part: Pick<LibraryPart, "id" | "storeSkus"> | undefined, variant?: string | null): string[] {
  if (!part) return [];
  const own = isPartColour(variant) ? VARIANT_SKUS[part.id]?.[variant] : undefined;
  return own ? [own, ...part.storeSkus.filter((s) => s !== own)] : part.storeSkus;
}

/** The part as drawn: an LED in its colour (model + accent); any other part unchanged. */
export function styledPart(part: LibraryPart, variant?: string | null): LibraryPart {
  if (!isPartColour(variant) || !hasVariants(part.id)) return part;
  const hex = PART_COLOURS[variant].hex;
  const model = part.model.kind === "procedural" ? { ...part.model, params: { ...part.model.params, colour: hex } } : part.model;
  return { ...part, model, look: { ...part.look, accent: hex } };
}

/** "Green" / "أخضر" for a colour, else "". */
export const colourName = (variant: string | null | undefined, locale: "en" | "ar") =>
  isPartColour(variant) ? PART_COLOURS[variant][locale] : "";
