// What makes two store products "the same product" (audit #7). One product
// per normalised name + material + pack size; migration 0030 enforces it with
// the unique index parts_name_key_uniq and keeps parts.name_key / parts.material
// normalised with a trigger. These functions are the TypeScript twins of
// public.part_name_key() and public.part_material_key() in 0030 — change one,
// change the other. Pure and client-safe.

// ASCII punctuation and symbols (!"#$%&'()*+,-./ :;<=>?@ [\]^_` {|}~), plus
// Unicode dashes, curly quotes, the ellipsis and the minus sign. Letters and
// digits in any script are kept. Listed explicitly (not \p{P}) so Postgres
// gives the same answer whatever its locale.
const PUNCT = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212]/g;
// The same set as Postgres' \s in the C locale, plus the no-break space that
// spreadsheets like to paste in.
const SPACE_RUN = /[ \t\n\v\f\r\u00a0]+/g;
const MATERIAL_SEP = /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212 \t\n\v\f\r\u00a0]+/g;

/** "Diode, 1N4148 (x10)" → "diode 1n4148 x10". Same as public.part_name_key(). */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(PUNCT, " ").replace(SPACE_RUN, " ").trim();
}

/**
 * " Stainless Steel " → "stainless_steel" (the snake_case convention from
 * migration 0011); blank → null. Same as public.part_material_key().
 */
export function normalizeMaterial(material: string | null | undefined): string | null {
  const v = (material ?? "").toLowerCase().replace(MATERIAL_SEP, "_").replace(/^_+|_+$/g, "");
  return v === "" ? null : v;
}

/** The identity the unique index checks: name key | material | pack size. */
export function partKey(
  name: string | null | undefined,
  material: string | null | undefined,
  packSize: number | null | undefined
): string {
  const pack = typeof packSize === "number" && Number.isInteger(packSize) && packSize >= 1 ? packSize : 1;
  return `${normalizeName(name)}|${normalizeMaterial(material) ?? ""}|${pack}`;
}

/**
 * Natural SKU order used to pick the surviving product in a duplicate group:
 * letters prefix, then the first number numerically, then the whole SKU —
 * so GR-024 < GR-034 < GR-114. Mirrors the ORDER BY in migration 0030.
 */
export function compareSku(a: string, b: string): number {
  const split = (s: string) => {
    const prefix = (s.match(/^[^0-9]*/)?.[0] ?? "").toUpperCase();
    const digits = s.match(/[0-9]+/)?.[0];
    return { prefix, num: digits === undefined ? null : BigInt(digits) };
  };
  const x = split(a);
  const y = split(b);
  if (x.prefix !== y.prefix) return x.prefix < y.prefix ? -1 : 1;
  if (x.num !== y.num) {
    if (x.num === null) return 1; // nulls last
    if (y.num === null) return -1;
    return x.num < y.num ? -1 : 1;
  }
  return a === b ? 0 : a < b ? -1 : 1;
}

/** The unique index from 0030. A 23505 naming it means "this product already exists". */
export const PARTS_NAME_KEY_INDEX = "parts_name_key_uniq";

export function isDuplicateProductError(
  error: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  return !!error && error.code === "23505" && (error.message ?? "").includes(PARTS_NAME_KEY_INDEX);
}

/** "stainless_steel" → "Stainless steel", for showing a stored material. */
export function materialLabel(material: string | null | undefined): string {
  const v = (material ?? "").replace(/_+/g, " ").trim();
  return v === "" ? "" : v.charAt(0).toUpperCase() + v.slice(1);
}
