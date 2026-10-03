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

// ── Description clean-up at render time (Phase C4) ──────────────────────────
// Supplier descriptions repeat the product's title and carry a "Links" list
// ("• 3D model") whose URLs were lost when the HTML was flattened to text.
// Both are handled here when the page renders; stored data is never edited.

export type ProductLink = { label: string; url: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, "")
    .trim();

const LINKS_HEADING = /^(links?|useful links?|روابط|الروابط)\s*:?$/i;
const LINKS_INLINE = /^(links?|روابط|الروابط)\s*[:•]\s*(.+)$/i;
const BULLET = /^[•\-*]\s*/;
const URL_RE = /https?:\/\/[^\s)>\]"']+/i;

function toLink(item: string): ProductLink | null {
  const m = URL_RE.exec(item);
  if (!m) return null;
  const url = m[0].replace(/[.,;]+$/, "");
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  const label = item.replace(m[0], "").replace(/[\s:–—-]+$/g, "").replace(/^[\s:–—-]+/g, "").trim();
  return { label: label || host, url };
}

/**
 * Take the product's own title and the "Links" section out of a description.
 * Links that carry a URL are returned (rendered as real links); entries
 * without one are dropped, so there is no dead "3D model" text.
 */
export function tidyDescription(
  text: string | null | undefined,
  titles: ReadonlyArray<string | null | undefined> = []
): { text: string | null; links: ProductLink[] } {
  if (!text) return { text: null, links: [] };
  const wanted = new Set(titles.filter((t): t is string => !!t).map(norm).filter(Boolean));
  const lines = text.split("\n");
  const keep: string[] = [];
  const links: ProductLink[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // The title again, as a line of its own.
    if (line && wanted.has(norm(line))) continue;

    // "Links" on its own line, bullets underneath.
    if (LINKS_HEADING.test(line)) {
      let j = i + 1;
      for (;;) {
        let k = j;
        while (k < lines.length && !lines[k].trim()) k++;
        if (k < lines.length && BULLET.test(lines[k].trim())) {
          const link = toLink(lines[k].trim().replace(BULLET, ""));
          if (link) links.push(link);
          j = k + 1;
        } else break;
      }
      i = j - 1;
      continue;
    }
    // "Links • 3D model" on one line.
    const inline = LINKS_INLINE.exec(line);
    if (inline) {
      for (const part of inline[2].split(/\s*[•]\s*/)) {
        const link = toLink(part);
        if (link) links.push(link);
      }
      continue;
    }
    keep.push(lines[i]);
  }

  const cleaned = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned || null, links };
}
