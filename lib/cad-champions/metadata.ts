// CAD Champions page metadata (pure). Every CC route is noindex until Prompt 12
// (the middleware also sends X-Robots-Tag on every CC response).

import type { Metadata } from "next";

import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/seo";

import { CC_LOCALES, ccPath } from "./routes";

export const CC_ROBOTS: NonNullable<Metadata["robots"]> = { index: false, follow: false };

/** Canonical + hreflang for one CC page (path without locale, e.g. "/dashboard"). */
export function ccAlternates(locale: Locale, path = "/"): NonNullable<Metadata["alternates"]> {
  const languages: Record<string, string> = {};
  for (const l of CC_LOCALES) languages[l] = `${SITE_URL}${ccPath(l, path)}`;
  languages["x-default"] = `${SITE_URL}${ccPath("en", path)}`;
  return { canonical: `${SITE_URL}${ccPath(locale, path)}`, languages };
}

/** The CC layout's metadata: title template, noindex, CC-only Open Graph (replaces the site's). */
export function ccLayoutMetadata(input: { locale: Locale; brand: string; description: string }): Metadata {
  const { locale, brand, description } = input;
  return {
    title: { default: brand, template: `%s · ${brand}` },
    description,
    robots: CC_ROBOTS,
    alternates: ccAlternates(locale, "/"),
    openGraph: {
      type: "website",
      siteName: brand,
      title: brand,
      description,
      locale: locale === "ar" ? "ar_QA" : "en_US",
      url: `${SITE_URL}${ccPath(locale, "/")}`,
    },
    twitter: { card: "summary", title: brand, description },
  };
}

/** One CC page: its title (the layout template adds the brand) and its own alternates. */
export function ccPageMetadata(input: { locale: Locale; path: string; title: string; absolute?: boolean }): Metadata {
  return {
    title: input.absolute ? { absolute: input.title } : input.title,
    alternates: ccAlternates(input.locale, input.path),
  };
}
