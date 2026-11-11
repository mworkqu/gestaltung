// Policy markdown (content/cad-champions/{privacy,terms,refunds}.{en,ar}.md) -
// SERVER ONLY. Each file is read with a LITERAL path.join(process.cwd(), ...)
// so Next's file tracer (nft) copies exactly these six files into the page
// functions; a computed file name would not be traced, and this way
// next.config.mjs (a main-site file) stays untouched. content.test.ts checks
// that the files exist.

import fs from "node:fs";
import path from "node:path";

import type { Locale } from "@/i18n/routing";

import { prepPolicyMarkdown } from "./prep";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/policies/content.ts is server-only");

export type PolicyId = "privacy" | "terms" | "refunds";

const readers: Record<PolicyId, Record<"en" | "ar", () => string>> = {
  privacy: {
    en: () => fs.readFileSync(path.join(process.cwd(), "content/cad-champions/privacy.en.md"), "utf8"),
    ar: () => fs.readFileSync(path.join(process.cwd(), "content/cad-champions/privacy.ar.md"), "utf8"),
  },
  terms: {
    en: () => fs.readFileSync(path.join(process.cwd(), "content/cad-champions/terms.en.md"), "utf8"),
    ar: () => fs.readFileSync(path.join(process.cwd(), "content/cad-champions/terms.ar.md"), "utf8"),
  },
  refunds: {
    en: () => fs.readFileSync(path.join(process.cwd(), "content/cad-champions/refunds.en.md"), "utf8"),
    ar: () => fs.readFileSync(path.join(process.cwd(), "content/cad-champions/refunds.ar.md"), "utf8"),
  },
};

/** The policy text for a locale, ready to render ("" if the file cannot be read). */
export function loadPolicy(id: PolicyId, locale: Locale, contactEmail: string): string {
  try {
    return prepPolicyMarkdown(readers[id][locale === "ar" ? "ar" : "en"](), contactEmail);
  } catch (e) {
    console.error("[cc-policies] could not read a policy file:", e instanceof Error ? e.message : "unknown");
    return "";
  }
}
