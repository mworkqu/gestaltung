// The specification table on a product page (owner, 2026-09-29: "get the
// datasheet and show its content on the page", not AI-filled specs).
//   DigiKey / Mouser products: the supplier's parameter table (parts.specs, 0041).
//   Voltaat products: the "Specifications" bullets their own description has
//   ("• Operating voltage: 7–24V DC"), lifted out so they aren't shown twice.

export type SpecRow = { name: string; value: string };

const HEADING = /^(technical\s+)?specifications?\s*:?$/i;
const NEXT_HEADING = /^(features|links|tutorials|package includes|in the box|documents?|applications?|notes?)\s*:?$/i;

/** Split a description into its text and its "Specifications" bullets. */
export function splitSpecs(description: string | null | undefined): { text: string | null; specs: SpecRow[] } {
  if (!description) return { text: null, specs: [] };
  const lines = description.split("\n");
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  if (start < 0) return { text: description, specs: [] };
  const specs: SpecRow[] = [];
  let end = start + 1;
  for (; end < lines.length; end++) {
    const l = lines[end].trim();
    if (NEXT_HEADING.test(l)) break;
    const m = /^[•\-*]?\s*([^:]{2,60}):\s*(.+)$/.exec(l);
    if (m) specs.push({ name: m[1].trim(), value: m[2].trim() });
  }
  if (!specs.length) return { text: description, specs: [] };
  const text = [...lines.slice(0, start), ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: text || null, specs };
}

/** The rows to show: the supplier's table when we have it, else the description's. */
export function productSpecs(part: { specs?: unknown; description?: string | null }): { text: string | null; specs: SpecRow[] } {
  const stored = Array.isArray(part.specs)
    ? (part.specs as SpecRow[]).filter((r) => r && typeof r.name === "string" && typeof r.value === "string")
    : [];
  if (stored.length) return { text: part.description ?? null, specs: stored };
  return splitSpecs(part.description);
}
