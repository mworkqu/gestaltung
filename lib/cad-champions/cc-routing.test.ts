import { describe, expect, it } from "vitest";

import { ccPublicPathname, ccRoute, isCcPath } from "./cc-routing";
import { ccLocaleCookieString, resolveCcLocale } from "./locale";

describe("ccRoute", () => {
  it("bare /cad-champions -> 307 to en by default", () => {
    expect(ccRoute("/cad-champions", "", undefined)).toEqual({ kind: "redirect", to: "/cad-champions/en", status: 307 });
  });

  it("bare /cad-champions uses the cc_locale cookie", () => {
    expect(ccRoute("/cad-champions", "", "ar")).toEqual({ kind: "redirect", to: "/cad-champions/ar", status: 307 });
  });

  it("ignores an invalid cookie", () => {
    expect(ccRoute("/cad-champions", "", "fr")).toEqual({ kind: "redirect", to: "/cad-champions/en", status: 307 });
  });

  it("trailing slash /cad-champions/ -> 307, query kept", () => {
    expect(ccRoute("/cad-champions/", "?a=1", "ar")).toEqual({
      kind: "redirect",
      to: "/cad-champions/ar?a=1",
      status: 307,
    });
  });

  it("/cad-champions/ar -> rewrite to the internal home", () => {
    expect(ccRoute("/cad-champions/ar", "", undefined)).toEqual({ kind: "rewrite", to: "/ar/cad-champions", locale: "ar" });
  });

  it("/cad-champions/ar/ -> rewrite to the internal home", () => {
    expect(ccRoute("/cad-champions/ar/", "", undefined)).toEqual({ kind: "rewrite", to: "/ar/cad-champions", locale: "ar" });
  });

  it("/cad-champions/ar/dashboard?x=1 -> rewrite, query kept", () => {
    expect(ccRoute("/cad-champions/ar/dashboard", "?x=1", "en")).toEqual({
      kind: "rewrite",
      to: "/ar/cad-champions/dashboard?x=1",
      locale: "ar",
    });
  });

  it("/cad-champions/en/help/step-file -> rewrite", () => {
    expect(ccRoute("/cad-champions/en/help/step-file", "", undefined)).toEqual({
      kind: "rewrite",
      to: "/en/cad-champions/help/step-file",
      locale: "en",
    });
  });

  it("/cad-champions/dashboard (no locale) -> 307 to the cookie locale", () => {
    expect(ccRoute("/cad-champions/dashboard", "?x=1", "ar")).toEqual({
      kind: "redirect",
      to: "/cad-champions/ar/dashboard?x=1",
      status: 307,
    });
  });

  it("/cad-champions/fr/x (unknown locale) -> 307 keeping the path (then the CC 404)", () => {
    expect(ccRoute("/cad-champions/fr/x", "", undefined)).toEqual({
      kind: "redirect",
      to: "/cad-champions/en/fr/x",
      status: 307,
    });
  });

  it("internal form /ar/cad-champions/x -> 308 to the public form, query kept", () => {
    expect(ccRoute("/ar/cad-champions/x", "?q=1", "en")).toEqual({
      kind: "redirect",
      to: "/cad-champions/ar/x?q=1",
      status: 308,
    });
  });

  it("internal home /en/cad-champions -> 308", () => {
    expect(ccRoute("/en/cad-champions", "", undefined)).toEqual({ kind: "redirect", to: "/cad-champions/en", status: 308 });
  });

  it.each(["/en", "/", "/ar", "/cad-championsX", "/cad-championsX/ar", "/en/store", "/en/cad-championsX", "/ar/store/cad-champions"])(
    "%s -> none",
    (p) => {
      expect(ccRoute(p, "", "ar")).toEqual({ kind: "none" });
    },
  );
});

describe("isCcPath", () => {
  it.each([
    ["/cad-champions", true],
    ["/cad-champions/ar/x", true],
    ["/cad-champions/x", true],
    ["/ar/cad-champions/x", true],
    ["/en/cad-champions", true],
    ["/cad-championsX", false],
    ["/dashboard", false],
    ["/", false],
    ["", false],
  ])("%s -> %s", (p, expected) => {
    expect(isCcPath(p)).toBe(expected);
  });
});

describe("ccPublicPathname", () => {
  it("normalises the internal form", () => {
    expect(ccPublicPathname("/ar/cad-champions/dashboard")).toBe("/cad-champions/ar/dashboard");
    expect(ccPublicPathname("/en/cad-champions")).toBe("/cad-champions/en");
  });
  it("keeps the public form", () => {
    expect(ccPublicPathname("/cad-champions/ar/x")).toBe("/cad-champions/ar/x");
  });
});

describe("locale helpers", () => {
  it("resolveCcLocale: cookie, else en", () => {
    expect(resolveCcLocale({ cookie: "ar" })).toBe("ar");
    expect(resolveCcLocale({ cookie: "en" })).toBe("en");
    expect(resolveCcLocale({ cookie: undefined })).toBe("en");
    expect(resolveCcLocale({ cookie: "AR" })).toBe("en");
  });
  it("cookie string: 1 year, path /, SameSite=Lax", () => {
    expect(ccLocaleCookieString("ar")).toBe("cc_locale=ar; Path=/; Max-Age=31536000; SameSite=Lax");
    expect(ccLocaleCookieString("en", { secure: true })).toContain("; Secure");
  });
});
