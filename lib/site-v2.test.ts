import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { STORE_URL_PARAMS } from "@/lib/store/catalog";
import {
  SITE_V2_PREVIEW_COOKIE,
  SITE_V2_PREVIEW_MAX_AGE,
  STORE_LISTING_PARAMS,
  V2_PATHS,
  parsePreviewRequest,
  parseSiteV2,
  parseSiteV2Rows,
  previewCookieOptions,
  previewRedirectPath,
  siteV2Affects,
  siteV2Route,
} from "@/lib/site-v2";

const LOCALES = ["en", "ar"] as const;
const route = (pathname: string, flagOn: boolean, hasPreviewCookie = false, search = "") =>
  siteV2Route({ pathname, search, flagOn, hasPreviewCookie });

describe("parseSiteV2", () => {
  it("only an explicit enabled: true is ON", () => {
    expect(parseSiteV2({ enabled: true })).toBe(true);
    expect(parseSiteV2({ enabled: true, note: "x" })).toBe(true);
  });
  it.each([
    [{ enabled: false }],
    [{ enabled: "true" }],
    [{ enabled: 1 }],
    [{}],
    [null],
    [undefined],
    [true],
    ["true"],
    [[{ enabled: true }]],
  ])("%j is OFF", (v) => {
    expect(parseSiteV2(v)).toBe(false);
  });
});

describe("parseSiteV2Rows (PostgREST answer)", () => {
  it("reads the first row's value", () => {
    expect(parseSiteV2Rows([{ value: { enabled: true } }])).toBe(true);
    expect(parseSiteV2Rows([{ value: { enabled: false } }])).toBe(false);
  });
  it("missing row / bad shapes are OFF", () => {
    expect(parseSiteV2Rows([])).toBe(false);
    expect(parseSiteV2Rows(null)).toBe(false);
    expect(parseSiteV2Rows({ value: { enabled: true } })).toBe(false);
    expect(parseSiteV2Rows([null])).toBe(false);
    expect(parseSiteV2Rows({ message: "error" })).toBe(false);
  });
});

describe("constants", () => {
  it("preview cookie name", () => {
    expect(SITE_V2_PREVIEW_COOKIE).toBe("site_v2");
  });
  it("V2_PATHS", () => {
    expect([...V2_PATHS]).toEqual(["", "/how-it-works", "/design", "/store"]);
  });
  it("store listing params match lib/store/catalog.ts and next.config.mjs", () => {
    expect([...STORE_LISTING_PARAMS].sort()).toEqual([...STORE_URL_PARAMS].sort());
    const config = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
    for (const key of STORE_LISTING_PARAMS) expect(config).toContain(`"${key}"`);
  });
});

describe.each(LOCALES)("siteV2Route — %s", (l) => {
  describe("flag ON", () => {
    it.each(V2_PATHS.map((p) => [p]))("rewrites the public path '%s'", (p) => {
      expect(route(`/${l}${p}`, true)).toEqual({ kind: "rewrite", to: `/${l}/v2${p}` });
    });
    it("accepts a trailing slash", () => {
      expect(route(`/${l}/`, true)).toEqual({ kind: "rewrite", to: `/${l}/v2` });
      expect(route(`/${l}/design/`, true)).toEqual({ kind: "rewrite", to: `/${l}/v2/design` });
    });
    it("keeps the query on a rewrite", () => {
      expect(route(`/${l}/store`, true, false, "?utm_source=x")).toEqual({
        kind: "rewrite",
        to: `/${l}/v2/store?utm_source=x`,
      });
      expect(route(`/${l}`, true, false, "?")).toEqual({ kind: "rewrite", to: `/${l}/v2` });
    });
    it.each(STORE_LISTING_PARAMS.map((k) => [k]))("leaves /store?%s=… to the search rewrite", (k) => {
      expect(route(`/${l}/store`, true, false, `?${k}=1`)).toEqual({ kind: "none" });
      expect(route(`/${l}/store`, true, false, `?utm=a&${k}=`)).toEqual({ kind: "none" });
    });
    it("listing params on other paths do not matter", () => {
      expect(route(`/${l}/design`, true, false, "?q=x")).toEqual({ kind: "rewrite", to: `/${l}/v2/design?q=x` });
    });
    it("other paths are untouched", () => {
      for (const p of ["/about", "/store/cart", "/store/search", "/design/quote", "/how-it-works/x", "/v2x", "/pricing"]) {
        expect(route(`/${l}${p}`, true)).toEqual({ kind: "none" });
      }
    });
    it("308s /v2… to the public URL, query kept, cookie irrelevant", () => {
      expect(route(`/${l}/v2`, true)).toEqual({ kind: "redirect", to: `/${l}` });
      expect(route(`/${l}/v2/`, true)).toEqual({ kind: "redirect", to: `/${l}` });
      expect(route(`/${l}/v2/store`, true, true, "?q=led")).toEqual({ kind: "redirect", to: `/${l}/store?q=led` });
      expect(route(`/${l}/v2/how-it-works`, true)).toEqual({ kind: "redirect", to: `/${l}/how-it-works` });
      expect(route(`/${l}/v2/design/`, true)).toEqual({ kind: "redirect", to: `/${l}/design` });
    });
  });

  describe("flag OFF", () => {
    it.each(V2_PATHS.map((p) => [p]))("public path '%s' untouched", (p) => {
      expect(route(`/${l}${p}`, false)).toEqual({ kind: "none" });
      expect(route(`/${l}${p}`, false, true)).toEqual({ kind: "none" });
    });
    it("/v2… is a 404 without the preview cookie", () => {
      for (const p of ["/v2", "/v2/", "/v2/store", "/v2/design", "/v2/how-it-works", "/v2/anything/else"]) {
        expect(route(`/${l}${p}`, false)).toEqual({ kind: "notFound", to: `/${l}/__v2-not-found` });
      }
    });
    it("/v2… passes through with the preview cookie", () => {
      for (const p of ["/v2", "/v2/store", "/v2/design"]) {
        expect(route(`/${l}${p}`, false, true)).toEqual({ kind: "none" });
      }
    });
  });
});

describe("siteV2Route — outside the locales", () => {
  it("unknown locale / root / non-matching", () => {
    expect(route("/", true)).toEqual({ kind: "none" });
    expect(route("/fr/store", true)).toEqual({ kind: "none" });
    expect(route("/fr/v2", false)).toEqual({ kind: "none" });
    expect(route("/store", true)).toEqual({ kind: "none" });
    expect(route("/v2", false)).toEqual({ kind: "none" });
  });
});

describe("siteV2Affects (when the middleware reads the flag)", () => {
  it.each(LOCALES)("%s", (l) => {
    for (const p of V2_PATHS) expect(siteV2Affects(`/${l}${p}`, "")).toBe(true);
    expect(siteV2Affects(`/${l}/`, "")).toBe(true);
    expect(siteV2Affects(`/${l}/v2`, "")).toBe(true);
    expect(siteV2Affects(`/${l}/v2/store`, "?q=x")).toBe(true);
    expect(siteV2Affects(`/${l}/store`, "?q=x")).toBe(false);
    expect(siteV2Affects(`/${l}/store`, "?page=2")).toBe(false);
    expect(siteV2Affects(`/${l}/store/cart`, "")).toBe(false);
    expect(siteV2Affects(`/${l}/about`, "")).toBe(false);
    expect(siteV2Affects(`/${l}/dashboard`, "")).toBe(false);
  });
  it("never outside the locales", () => {
    expect(siteV2Affects("/", "")).toBe(false);
    expect(siteV2Affects("/store", "")).toBe(false);
  });
});

describe("preview route helpers", () => {
  it("defaults: on, en", () => {
    expect(parsePreviewRequest(new URLSearchParams())).toEqual({ on: true, locale: "en" });
  });
  it("on=0 turns it off; locale ar kept; unknown locale → en", () => {
    expect(parsePreviewRequest(new URLSearchParams("on=0&locale=ar"))).toEqual({ on: false, locale: "ar" });
    expect(parsePreviewRequest(new URLSearchParams("on=1&locale=fr"))).toEqual({ on: true, locale: "en" });
  });
  it("redirect paths", () => {
    expect(previewRedirectPath({ on: true, locale: "ar" })).toBe("/ar/v2");
    expect(previewRedirectPath({ on: false, locale: "en" })).toBe("/en");
  });
  it("cookie options", () => {
    expect(previewCookieOptions(true)).toEqual({
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: SITE_V2_PREVIEW_MAX_AGE,
    });
    expect(previewCookieOptions(false).secure).toBe(false);
    expect(SITE_V2_PREVIEW_MAX_AGE).toBe(604800);
  });
});
