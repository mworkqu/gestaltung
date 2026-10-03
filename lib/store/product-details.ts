// What a product page shows under "Description" and "Specifications", per
// locale (Phase E1, 2026-10-03).
//
//   en: unchanged — the supplier description (title lines and the "Links"
//       list taken out) and the spec table (supplier table, else the
//       description's own "Specifications" bullets). See lib/store/specs.ts.
//   ar: ONLY Arabic: parts.description_ar and parts.specs_ar (0047, filled by
//       the admin "translate_details" step). Raw English supplier text is
//       never shown on /ar. When the Arabic is missing, `untranslated` says
//       so and the page shows its Arabic headings with a short note instead.
//
// `plainDescription` is the same text on one line, for meta descriptions:
// null when there is nothing in the page's language (callers then use their
// own localized fallback, never the English text).

import { productSpecs, tidyDescription, type ProductLink, type SpecRow } from "@/lib/store/specs";

export type ProductDetailsInput = {
  name: string;
  name_ar?: string | null;
  description?: string | null;
  description_ar?: string | null;
  /** 0041: supplier spec table [{name, value}]. */
  specs?: unknown;
  /** 0047: the same rows in Arabic, aligned with the English rows. */
  specs_ar?: unknown;
};

export type ProductDetails = {
  description: string | null;
  specs: SpecRow[];
  links: ProductLink[];
  /** One line, whitespace collapsed; null when nothing in this locale. */
  plainDescription: string | null;
  /** ar only: English source exists but its Arabic does not (yet). */
  untranslated: { description: boolean; specs: boolean };
};

/** A stored [{name, value}] array, or [] for anything else. */
export function specRows(value: unknown): SpecRow[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (r): r is SpecRow =>
        !!r && typeof r === "object" && typeof (r as SpecRow).name === "string" && typeof (r as SpecRow).value === "string"
    )
    .map((r) => ({ name: r.name.trim(), value: r.value.trim() }))
    .filter((r) => r.name && r.value);
}

const plain = (s: string | null) => {
  const one = (s ?? "").replace(/\s+/g, " ").trim();
  return one || null;
};

/** The English description and spec rows, exactly as /en renders them. */
function englishDetails(part: ProductDetailsInput) {
  const { text: raw, specs } = productSpecs({ specs: part.specs, description: part.description ?? null });
  const { text, links } = tidyDescription(raw, [part.name, part.name_ar]);
  return { description: text, specs, links };
}

export function productDetailsForLocale(part: ProductDetailsInput, locale: string): ProductDetails {
  const en = englishDetails(part);
  if (locale !== "ar") {
    return {
      description: en.description,
      specs: en.specs,
      links: en.links,
      plainDescription: plain(en.description),
      untranslated: { description: false, specs: false },
    };
  }

  const arText = (part.description_ar ?? "").trim();
  const description = arText ? tidyDescription(arText, [part.name, part.name_ar]).text : null;
  const specs = specRows(part.specs_ar);
  return {
    description,
    specs,
    // Only the URL is neutral; the supplier's English label is replaced by
    // the host name.
    links: en.links.map((l) => ({ label: hostOf(l.url), url: l.url })),
    plainDescription: plain(description),
    untranslated: {
      description: !description && !!en.description,
      specs: specs.length === 0 && en.specs.length > 0,
    },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
