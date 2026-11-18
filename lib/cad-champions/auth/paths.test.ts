import { describe, expect, it } from "vitest";

import { resolveCcLocale } from "../locale";
import {
  CC_PROTECTED_PREFIXES,
  ccCallbackUrl,
  ccContinueHref,
  ccNextOrNull,
  ccSignInHref,
  ccSignUpHref,
  isCcProtected,
  isCcStaffPath,
  safeCcNext,
} from "./paths";

describe("isCcProtected", () => {
  it("protects every listed prefix and its children", () => {
    for (const p of CC_PROTECTED_PREFIXES) {
      expect(isCcProtected(p)).toBe(true);
      expect(isCcProtected(`${p}/x`)).toBe(true);
      expect(isCcProtected(`${p}/`)).toBe(true);
      expect(isCcProtected(`${p}?a=1`)).toBe(true);
    }
  });
  it("keeps public pages public", () => {
    for (const p of ["/", "", "/help", "/help/x", "/sign-in", "/sign-up", "/privacy", "/terms", "/dashboards", "/testing", "/check-email", "/auth/continue"]) {
      expect(isCcProtected(p)).toBe(false);
    }
  });
  it("staff paths", () => {
    expect(isCcStaffPath("/admin")).toBe(true);
    expect(isCcStaffPath("/admin/users")).toBe(true);
    expect(isCcStaffPath("/administrator")).toBe(false);
    expect(isCcStaffPath("/dashboard")).toBe(false);
  });
});

describe("safeCcNext", () => {
  it("accepts CC paths and keeps query + hash", () => {
    expect(safeCcNext("/cad-champions/en/test?x=1#a", "en")).toBe("/cad-champions/en/test?x=1#a");
    expect(safeCcNext("/cad-champions/en/", "en")).toBe("/cad-champions/en");
  });
  it("switches to the requested locale", () => {
    expect(safeCcNext("/cad-champions/en/results", "ar")).toBe("/cad-champions/ar/results");
  });
  it("falls back to the dashboard for anything unsafe", () => {
    const bad: unknown[] = [
      null,
      undefined,
      42,
      "",
      "https://evil.com/cad-champions/en/x",
      "//evil.com/cad-champions/en/x",
      "/\\evil.com",
      "/en/dashboard",
      "/cad-champions/fr/x",
      "/cad-champions/dashboard",
      "/cad-champions/en/sign-in",
      "/cad-champions/en/sign-up?next=x",
      "/cad-champions/en/auth/continue",
      "/cad-champions/en/reset-password",
      "/cad-champions/en/x\u0000",
      "javascript:alert(1)",
      `/cad-champions/en/${"a".repeat(2000)}`,
    ];
    for (const b of bad) expect(safeCcNext(b, "en")).toBe("/cad-champions/en/dashboard");
    expect(safeCcNext("nope", "ar")).toBe("/cad-champions/ar/dashboard");
  });
  it("normalises dot segments before checking", () => {
    expect(ccNextOrNull("/cad-champions/en/../../evil", "en")).toBeNull();
    expect(ccNextOrNull("/cad-champions/en/x/../test", "en")).toBe("/cad-champions/en/test");
  });
});

describe("hrefs", () => {
  it("ccSignInHref / ccSignUpHref add a safe next only", () => {
    expect(ccSignInHref("en")).toBe("/cad-champions/en/sign-in");
    expect(ccSignInHref("ar", "/cad-champions/ar/test?a=1")).toBe(
      "/cad-champions/ar/sign-in?next=%2Fcad-champions%2Far%2Ftest%3Fa%3D1",
    );
    expect(ccSignInHref("en", "https://evil.com")).toBe("/cad-champions/en/sign-in");
    expect(ccSignUpHref("en", "/cad-champions/en/results")).toBe(
      "/cad-champions/en/sign-up?next=%2Fcad-champions%2Fen%2Fresults",
    );
  });
  it("ccContinueHref + ccCallbackUrl", () => {
    expect(ccContinueHref("en", "/cad-champions/en/results")).toBe(
      "/cad-champions/en/auth/continue?next=%2Fcad-champions%2Fen%2Fresults",
    );
    expect(ccContinueHref("en")).toBe("/cad-champions/en/auth/continue");
    expect(ccCallbackUrl("https://x.com/", "/cad-champions/en/auth/continue")).toBe(
      "https://x.com/api/auth/callback?next=%2Fcad-champions%2Fen%2Fauth%2Fcontinue",
    );
  });
});

describe("resolveCcLocale with a profile", () => {
  it("profile wins, then cookie, then en", () => {
    expect(resolveCcLocale({ profileLocale: "ar", cookie: "en" })).toBe("ar");
    expect(resolveCcLocale({ profileLocale: "en", cookie: "ar" })).toBe("en");
    expect(resolveCcLocale({ profileLocale: "xx", cookie: "ar" })).toBe("ar");
    expect(resolveCcLocale({ profileLocale: null, cookie: null })).toBe("en");
  });
});
