import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseMarkdown, type Block } from "@/lib/legal/markdown";

export const LEGAL_SLUGS = ["delivery-returns", "warranty", "terms", "privacy"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** Message-key prefix per slug (Legal.<prefix>Title / <prefix>Footer). */
export const LEGAL_KEYS: Record<LegalSlug, "deliveryReturns" | "warranty" | "terms" | "privacy"> = {
  "delivery-returns": "deliveryReturns",
  warranty: "warranty",
  terms: "terms",
  privacy: "privacy",
};

/**
 * The owner's text for one page + language, read at build time from
 * content/legal/<slug>.<locale>.md (generated verbatim by
 * scripts/split-legal-draft.mjs — never edited by hand).
 */
export function loadLegalContent(slug: LegalSlug, locale: string): Block[] {
  const lang = locale === "ar" ? "ar" : "en";
  const file = join(process.cwd(), "content", "legal", `${slug}.${lang}.md`);
  return parseMarkdown(readFileSync(file, "utf8"));
}
