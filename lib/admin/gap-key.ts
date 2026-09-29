// One row per kind of part on the "Parts customers need" page (audit Phase 6):
// "Resistors", "resistor 220 Ω" and "220ohm resistor" are the same need, with
// the values kept as specs. Lower-case, drop values/units and filler words,
// singular.

const VALUE = /\b\d+(?:[.,]\d+)?\s*(?:k|m|µ|u|n|p)?(?:ω|ohms?|Ω|f|v|a|ma|mah|w|mm|cm|hz|khz|mhz)?\b/gi;
const FILLER = new Set(["a", "an", "the", "for", "of", "with", "and", "x", "pcs", "pc", "piece", "pieces", "pack", "set"]);

const singular = (w: string) =>
  w.length > 3 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;

export function gapKey(fn: string): string {
  const words = fn
    .toLowerCase()
    .replace(VALUE, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w))
    .map(singular);
  return words.join(" ").trim() || fn.trim().toLowerCase();
}

/** A readable label for a group key ("resistor" → "Resistor"). */
export const gapLabel = (key: string) => key.charAt(0).toUpperCase() + key.slice(1);
