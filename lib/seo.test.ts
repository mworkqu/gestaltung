import { describe, expect, it } from "vitest";

import {
  ROBOTS_DISALLOW,
  SITE_URL,
  SITEMAP_STATIC_PATHS,
  absoluteUrl,
  clipText,
  languageAlternates,
  localizedPath,
  ogProductImage,
  pageMetadata,
  robotsRules,
  siteDefaults,
  sitemapEntries,
} from "./seo";

describe("urls", () => {
  it("builds absolute, locale-prefixed URLs", () => {
    expect(absoluteUrl("en", "/store")).toBe("https://gestaltung360.com/en/store");
    expect(absoluteUrl("ar", "/store")).toBe("https://gestaltung360.com/ar/store");
    expect(absoluteUrl("en", "")).toBe("https://gestaltung360.com/en");
    expect(absoluteUrl("ar", "/")).toBe("https://gestaltung360.com/ar");
    expect(absoluteUrl("ar", "/store/")).toBe("https://gestaltung360.com/ar/store");
  });

  it("falls back to the default locale for anything but ar", () => {
    expect(localizedPath("fr", "/about")).toBe("/en/about");
  });

  it("hreflang map has en, ar and x-default -> the English URL", () => {
    expect(languageAlternates("/store/ABC-1")).toEqual({
      en: "https://gestaltung360.com/en/store/ABC-1",
      ar: "https://gestaltung360.com/ar/store/ABC-1",
      "x-default": "https://gestaltung360.com/en/store/ABC-1",
    });
  });
});

describe("pageMetadata", () => {
  const meta = pageMetadata({
    locale: "ar",
    path: "/store",
    title: "تسوّق القطع | Gestaltung360",
    description: "وصف",
  });

  it("canonical is absolute and locale specific", () => {
    expect(meta.alternates?.canonical).toBe("https://gestaltung360.com/ar/store");
    const en = pageMetadata({ locale: "en", path: "/store", title: "Shop parts | Gestaltung360" });
    expect(en.alternates?.canonical).toBe("https://gestaltung360.com/en/store");
  });

  it("languages has en, ar and x-default (English)", () => {
    const langs = meta.alternates?.languages as Record<string, string>;
    expect(Object.keys(langs).sort()).toEqual(["ar", "en", "x-default"]);
    expect(langs.en).toBe("https://gestaltung360.com/en/store");
    expect(langs["x-default"]).toBe(langs.en);
  });

  it("openGraph has title, images, locale and alternate locale", () => {
    const og = meta.openGraph!;
    expect(og.title).toBe("تسوّق القطع | Gestaltung360");
    expect(og.description).toBe("وصف");
    expect(og.url).toBe("https://gestaltung360.com/ar/store");
    expect(og.locale).toBe("ar_QA");
    expect(og.alternateLocale).toEqual(["en_US"]);
    const images = og.images as { url: string; width?: number; height?: number }[];
    expect(images).toHaveLength(1);
    expect(images[0].url).toBe("https://gestaltung360.com/ar/opengraph-image");
    expect(images[0].width).toBe(1200);
    expect(images[0].height).toBe(630);
  });

  it("English page: en_US with ar_QA alternate", () => {
    const en = pageMetadata({ locale: "en", path: "", title: "Home" });
    expect(en.openGraph?.locale).toBe("en_US");
    expect(en.openGraph?.alternateLocale).toEqual(["ar_QA"]);
    expect(en.alternates?.canonical).toBe("https://gestaltung360.com/en");
  });

  it("twitter is a large image card with the same image", () => {
    const tw = meta.twitter as { card: string; title: string; images: string[] };
    expect(tw.card).toBe("summary_large_image");
    expect(tw.title).toBe("تسوّق القطع | Gestaltung360");
    expect(tw.images).toEqual(["https://gestaltung360.com/ar/opengraph-image"]);
  });

  it("a product page: own image, separate og description, price tags", () => {
    const p = pageMetadata({
      locale: "en",
      path: "/store/ABC-1",
      title: "Servo | Gestaltung360",
      description: "A servo.",
      ogDescription: "QAR 78.00 · A servo.",
      image: "https://cdn.shopify.com/s/files/x.jpg?width=1200",
      imageAlt: "Servo",
      other: { "product:price:amount": "78.00", "product:price:currency": "QAR" },
    });
    expect(p.description).toBe("A servo.");
    expect(p.openGraph?.description).toBe("QAR 78.00 · A servo.");
    expect((p.twitter as { description: string }).description).toBe("QAR 78.00 · A servo.");
    expect((p.openGraph?.images as { url: string; alt: string }[])[0]).toEqual({
      url: "https://cdn.shopify.com/s/files/x.jpg?width=1200",
      alt: "Servo",
    });
    expect(p.other).toEqual({ "product:price:amount": "78.00", "product:price:currency": "QAR" });
  });

  it("noindex pages: robots noindex, no canonical or own social card", () => {
    const m = pageMetadata({ locale: "en", path: "/dashboard", title: "Dashboard | Gestaltung360", noindex: true });
    expect(m.robots).toEqual({ index: false, follow: false });
    expect(m.alternates).toBeUndefined();
    expect(m.openGraph).toBeUndefined();
    expect("description" in m).toBe(false);
  });

  it("indexable pages carry no robots override", () => {
    expect(meta.robots).toBeUndefined();
  });
});

describe("siteDefaults", () => {
  const d = siteDefaults({ locale: "en", title: "T", description: "D" });
  it("sets metadataBase and no canonical/hreflang (children would inherit them)", () => {
    expect(String(d.metadataBase)).toBe(`${SITE_URL}/`);
    expect(d.alternates).toBeUndefined();
    expect(d.openGraph?.url).toBeUndefined();
  });
  it("has a default share image and twitter card", () => {
    expect((d.openGraph?.images as { url: string }[])[0].url).toBe("https://gestaltung360.com/en/opengraph-image");
    expect((d.twitter as { card: string }).card).toBe("summary_large_image");
  });
});

describe("ogProductImage", () => {
  it("uses the Shopify CDN width variant", () => {
    expect(ogProductImage("https://cdn.shopify.com/s/files/1/a.jpg")).toBe(
      "https://cdn.shopify.com/s/files/1/a.jpg?width=1200"
    );
    expect(ogProductImage("https://cdn.shopify.com/s/files/1/a.jpg?v=123&width=400")).toBe(
      "https://cdn.shopify.com/s/files/1/a.jpg?v=123&width=1200"
    );
  });
  it("leaves other https hosts alone, rejects junk and http", () => {
    expect(ogProductImage("https://example.supabase.co/storage/v1/object/public/a-web.webp")).toBe(
      "https://example.supabase.co/storage/v1/object/public/a-web.webp"
    );
    expect(ogProductImage("http://cdn.shopify.com/a.jpg")).toBeNull();
    expect(ogProductImage("[link removed]")).toBeNull();
    expect(ogProductImage(null)).toBeNull();
  });
});

describe("clipText", () => {
  it("collapses whitespace and clips with an ellipsis", () => {
    expect(clipText("a  b\n c", 50)).toBe("a b c");
    const out = clipText("x".repeat(300), 155);
    expect(out).toHaveLength(155);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("sitemapEntries", () => {
  const products = [
    { sku: "VLT-1", updated_at: "2026-09-30T10:00:00Z" },
    { sku: "DK 2/x", updated_at: null },
    { sku: "VLT-1", updated_at: "2026-10-01T10:00:00Z" }, // duplicate
    { sku: "  ", updated_at: null },
  ];
  const entries = sitemapEntries(products);

  it("has both locales for every static page", () => {
    for (const path of SITEMAP_STATIC_PATHS) {
      expect(entries.map((e) => e.url)).toContain(absoluteUrl("en", path));
      expect(entries.map((e) => e.url)).toContain(absoluteUrl("ar", path));
    }
  });

  it("has both locales for each distinct product, SKU encoded", () => {
    const urls = entries.map((e) => e.url);
    expect(urls).toContain("https://gestaltung360.com/en/store/VLT-1");
    expect(urls).toContain("https://gestaltung360.com/ar/store/VLT-1");
    expect(urls).toContain("https://gestaltung360.com/en/store/DK%202%2Fx");
    expect(urls.filter((u) => u.endsWith("/store/VLT-1"))).toHaveLength(2);
    expect(entries).toHaveLength(SITEMAP_STATIC_PATHS.length * 2 + 2 * 2);
  });

  it("every entry is absolute and carries en/ar/x-default alternates", () => {
    for (const e of entries) {
      expect(e.url.startsWith(`${SITE_URL}/`)).toBe(true);
      const langs = e.alternates?.languages as Record<string, string>;
      expect(Object.keys(langs).sort()).toEqual(["ar", "en", "x-default"]);
      expect(langs["x-default"]).toBe(langs.en);
      expect(Object.values(langs)).toContain(e.url);
    }
  });

  it("lastModified comes from updated_at when valid", () => {
    const vlt = entries.find((e) => e.url.endsWith("/en/store/VLT-1"))!;
    expect(vlt.lastModified).toEqual(new Date("2026-09-30T10:00:00Z"));
    const dk = entries.find((e) => e.url.endsWith("/en/store/DK%202%2Fx"))!;
    expect(dk.lastModified).toBeUndefined();
  });

  it("never lists private or transactional paths", () => {
    const banned = ["/dashboard", "/inventory", "/api", "/cart", "/checkout", "/sign-in", "/sign-up", "/credits",
      "/reset-password", "/forgot-password", "/my-inventory", "/projects/"];
    for (const e of entries) {
      const path = e.url.replace(SITE_URL, "");
      for (const b of banned) {
        if (b === "/projects/") {
          // /projects/new is the public "Plan a product" page; no project ids.
          expect(path.replace(/\/(en|ar)\/projects\/new$/, "")).not.toContain("/projects/");
        } else {
          expect(path).not.toContain(b);
        }
      }
    }
  });
});

describe("robotsRules", () => {
  const r = robotsRules();
  const rule = (Array.isArray(r.rules) ? r.rules[0] : r.rules) as {
    userAgent: string;
    allow: string;
    disallow: string[];
  };

  it("allows everything for all agents and disallows the private areas", () => {
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toBe("/");
    expect(rule.disallow).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/inventory",
        "/api",
        "/en/dashboard",
        "/ar/dashboard",
        "/en/inventory",
        "/ar/inventory",
      ])
    );
    expect(rule.disallow).toEqual(ROBOTS_DISALLOW);
  });

  it("points at the sitemap", () => {
    expect(r.sitemap).toBe("https://gestaltung360.com/sitemap.xml");
  });
});
