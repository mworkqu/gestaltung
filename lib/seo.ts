// Sitewide SEO + sharing helpers: canonical and hreflang URLs, Open Graph /
// Twitter metadata, the sitemap entries and the robots rules. Pure functions
// (no Next runtime, no I/O) so they are unit-tested in lib/seo.test.ts; the
// route files (app/sitemap.ts, app/robots.ts) and every page's
// generateMetadata only call into this file.

import type { Metadata, MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { sizedImage } from "@/lib/store/image-url";

export const SITE_URL = "https://gestaltung360.com";
export const SITE_NAME = "Gestaltung360";

export type SeoLocale = "en" | "ar";

const OG_LOCALE: Record<SeoLocale, string> = { en: "en_US", ar: "ar_QA" };

export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** "ar" stays "ar"; anything else is the default locale. */
export function seoLocale(locale: string): SeoLocale {
  return locale === "ar" ? "ar" : "en";
}

/** og:locale:alternate values: every locale except the current one. */
function alternateOgLocales(locale: SeoLocale): string[] {
  return routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]);
}

/** "/store" + "en" -> "/en/store"; "" or "/" -> "/en" (the locale home). */
export function localizedPath(locale: string, path = ""): string {
  const trimmed = path.replace(/\/+$/, "");
  const clean = trimmed && !trimmed.startsWith("/") ? `/${trimmed}` : trimmed;
  return `/${seoLocale(locale)}${clean}`;
}

/** Absolute, locale-specific URL of a page. `path` has no locale prefix. */
export function absoluteUrl(locale: string, path = ""): string {
  return `${SITE_URL}${localizedPath(locale, path)}`;
}

/** hreflang map for a page: en, ar, and x-default -> the English URL. */
export function languageAlternates(path = ""): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = absoluteUrl(l, path);
  languages["x-default"] = absoluteUrl(routing.defaultLocale, path);
  return languages;
}

/** The generated brand card (app/[locale]/opengraph-image.tsx). */
export function defaultOgImage(locale: string): string {
  return `${SITE_URL}/${seoLocale(locale)}/opengraph-image`;
}

/**
 * A product photo as an Open Graph image URL: absolute https only, and the
 * Shopify CDN's `?width=1200` variant so crawlers don't fetch a full-size
 * original. Other hosts (our own storage) are returned unchanged.
 */
export function ogProductImage(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  // Same resizing rule as the storefront photos (lib/store/image-url.ts).
  return sizedImage(u.toString(), OG_IMAGE_SIZE.width);
}

/** Collapse whitespace and cut to `max` characters (with an ellipsis). */
export function clipText(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

export type PageMetadataInput = {
  locale: string;
  /** Path without the locale prefix: "/store", "/store/ABC-1", "" for home. */
  path: string;
  title: string;
  description?: string;
  /** Absolute image URL; defaults to the generated brand card. */
  image?: string | null;
  imageAlt?: string;
  /** Next's OpenGraph type union has no "product"; products use "website". */
  type?: "website" | "article";
  /** Open Graph description when it should differ from the meta description. */
  ogDescription?: string;
  /** Extra <meta name=...> tags (e.g. product:price:amount). */
  other?: NonNullable<Metadata["other"]>;
  /**
   * Private / transactional pages: robots noindex, and no canonical, hreflang
   * or Open Graph of their own (the locale layout's generic card is inherited).
   */
  noindex?: boolean;
};

/**
 * The one place page metadata is built: title, description, canonical +
 * hreflang, Open Graph and Twitter (large image card).
 */
export function pageMetadata(input: PageMetadataInput): Metadata {
  const { title, description, noindex } = input;
  const locale = seoLocale(input.locale);

  // Undefined keys are left out: a present-but-undefined `description` would
  // wipe the inherited one.
  const base: Metadata = { title, ...(description ? { description } : {}) };

  if (noindex) {
    return { ...base, robots: { index: false, follow: false } };
  }

  const canonical = absoluteUrl(locale, input.path);
  const image = input.image || defaultOgImage(locale);
  const isDefaultImage = !input.image;
  const ogDescription = input.ogDescription ?? description;
  const alt = input.imageAlt ?? title;

  return {
    ...base,
    alternates: { canonical, languages: languageAlternates(input.path) },
    openGraph: {
      type: input.type ?? "website",
      url: canonical,
      siteName: SITE_NAME,
      title,
      ...(ogDescription ? { description: ogDescription } : {}),
      locale: OG_LOCALE[locale],
      alternateLocale: alternateOgLocales(locale),
      images: [
        isDefaultImage
          ? { url: image, width: OG_IMAGE_SIZE.width, height: OG_IMAGE_SIZE.height, alt }
          : { url: image, alt },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      ...(ogDescription ? { description: ogDescription } : {}),
      images: [image],
    },
    ...(input.other ? { other: input.other } : {}),
  };
}

/**
 * Sitewide defaults set once by the locale layout. Deliberately NO canonical
 * or hreflang here: those are inherited by every page below and would point
 * them all at the home page. Pages add their own through pageMetadata().
 */
export function siteDefaults(input: { locale: string; title: string; description: string }): Metadata {
  const locale = seoLocale(input.locale);
  const image = defaultOgImage(locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: input.title,
    description: input.description,
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: input.title,
      description: input.description,
      locale: OG_LOCALE[locale],
      alternateLocale: alternateOgLocales(locale),
      images: [{ url: image, width: OG_IMAGE_SIZE.width, height: OG_IMAGE_SIZE.height, alt: input.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [image],
    },
  };
}

// ---------------------------------------------------------------- sitemap

/** Public, indexable pages (locale-less paths). Private areas never appear. */
export const SITEMAP_STATIC_PATHS = [
  "",
  "/store",
  "/design",
  "/design/quote",
  "/design/drawing",
  "/how-it-works",
  "/about",
  "/contact",
  "/projects/new",
  "/delivery-returns",
  "/warranty",
  "/terms",
  "/privacy",
] as const;

export type SitemapProduct = { sku: string; updated_at?: string | null };

function entryFor(locale: string, path: string, lastModified?: Date): MetadataRoute.Sitemap[number] {
  return {
    url: absoluteUrl(locale, path),
    ...(lastModified ? { lastModified } : {}),
    alternates: { languages: languageAlternates(path) },
  };
}

/** One entry per page per locale, each carrying the en/ar/x-default alternates. */
export function sitemapEntries(
  products: SitemapProduct[],
  staticPaths: readonly string[] = SITEMAP_STATIC_PATHS
): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];
  for (const path of staticPaths) {
    for (const locale of routing.locales) entries.push(entryFor(locale, path));
  }
  const seen = new Set<string>();
  for (const p of products) {
    const sku = (p.sku ?? "").trim();
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const path = `/store/${encodeURIComponent(sku)}`;
    const when = p.updated_at ? new Date(p.updated_at) : undefined;
    const lastModified = when && !Number.isNaN(when.getTime()) ? when : undefined;
    for (const locale of routing.locales) entries.push(entryFor(locale, path, lastModified));
  }
  return entries;
}

// ----------------------------------------------------------------- robots

/** Areas kept out of search: signed-in pages and the API, bare and per locale. */
export const ROBOTS_DISALLOW = [
  "/dashboard",
  "/inventory",
  "/api",
  ...routing.locales.flatMap((l) => [`/${l}/dashboard`, `/${l}/inventory`]),
];

export function robotsRules(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW }],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
