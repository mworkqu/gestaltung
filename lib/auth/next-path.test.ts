import { describe, expect, it } from "vitest";

import {
  afterAuthPath,
  callbackNextPath,
  authAltHref,
  returnsToProject,
  safeNextPath,
  signInHref,
  signUpHref,
} from "@/lib/auth/next-path";

describe("safeNextPath", () => {
  it("keeps a locale-prefixed path with its query and hash", () => {
    expect(safeNextPath("/en/projects/abc/studio?step=wiring", "en")).toBe("/en/projects/abc/studio?step=wiring");
    expect(safeNextPath("/ar/projects?x=1#top", "ar")).toBe("/ar/projects?x=1#top");
    expect(safeNextPath("/en", "en")).toBe("/en");
  });

  it("switches the locale to the one the visitor chose", () => {
    expect(safeNextPath("/en/projects/abc/studio?step=parts", "ar")).toBe("/ar/projects/abc/studio?step=parts");
  });

  it("rejects anything that is not a same-origin path", () => {
    for (const bad of [
      "https://evil.example/en/x",
      "//evil.example/en/x",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "en/projects",
      "/en/projects\n/x",
      "/en/\u0000x",
      "",
      "   ",
    ]) {
      expect(safeNextPath(bad, "en"), bad).toBeNull();
    }
  });

  it("rejects paths outside our locales or that escape them", () => {
    expect(safeNextPath("/projects/abc", "en")).toBeNull();
    expect(safeNextPath("/fr/projects", "en")).toBeNull();
    expect(safeNextPath("/english/x", "en")).toBeNull();
    expect(safeNextPath("/en/../../etc", "en")).toBeNull();
    expect(safeNextPath("/en/%2e%2e/x", "en")).toBeNull();
    expect(safeNextPath("/api/auth/claim-guest", "en")).toBeNull();
  });

  it("never returns to the auth forms (no loop)", () => {
    expect(safeNextPath("/en/sign-in?next=/en/x", "en")).toBeNull();
    expect(safeNextPath("/ar/sign-up", "ar")).toBeNull();
    expect(safeNextPath("/en/forgot-password", "en")).toBeNull();
    expect(safeNextPath("/en/reset-password/", "en")).toBeNull();
    expect(safeNextPath("/en/sign-insights", "en")).toBe("/en/sign-insights");
  });

  it("rejects non-strings and very long values", () => {
    expect(safeNextPath(null, "en")).toBeNull();
    expect(safeNextPath(undefined, "en")).toBeNull();
    expect(safeNextPath(["/en/x"], "en")).toBeNull();
    expect(safeNextPath(`/en/${"a".repeat(2000)}`, "en")).toBeNull();
  });
});

describe("afterAuthPath", () => {
  it("uses next when safe, else the dashboard of the locale", () => {
    expect(afterAuthPath("/en/projects/a/studio?step=wiring", "en")).toBe("/en/projects/a/studio?step=wiring");
    expect(afterAuthPath("https://evil.example", "ar")).toBe("/ar/dashboard");
    expect(afterAuthPath(null, "en")).toBe("/en/dashboard");
  });
});

describe("authAltHref / returnsToProject", () => {
  it("keeps next on the switch between the two forms", () => {
    expect(authAltHref("/sign-up", "/en/projects/a/studio?step=wiring")).toBe(
      "/sign-up?next=%2Fen%2Fprojects%2Fa%2Fstudio%3Fstep%3Dwiring",
    );
    expect(authAltHref("/sign-in", null)).toBe("/sign-in");
  });

  it("knows a project page", () => {
    expect(returnsToProject("/en/projects/a/studio?step=wiring")).toBe(true);
    expect(returnsToProject("/ar/projects/a")).toBe(true);
    expect(returnsToProject("/en/projects")).toBe(false);
    expect(returnsToProject("/en/store")).toBe(false);
    expect(returnsToProject(null)).toBe(false);
  });
});

describe("signInHref / signUpHref", () => {
  it("carries the current path as an encoded next", () => {
    expect(signInHref("en", "/en/projects/a/studio?step=wiring")).toBe(
      "/en/sign-in?next=%2Fen%2Fprojects%2Fa%2Fstudio%3Fstep%3Dwiring",
    );
    expect(signUpHref("ar", "/ar/projects/a/studio?step=parts")).toBe(
      "/ar/sign-up?next=%2Far%2Fprojects%2Fa%2Fstudio%3Fstep%3Dparts",
    );
  });

  it("drops an unsafe or missing current path", () => {
    expect(signInHref("en", null)).toBe("/en/sign-in");
    expect(signInHref("en", "//evil.example")).toBe("/en/sign-in");
    expect(signInHref("en", "/en/sign-in")).toBe("/en/sign-in");
  });
});

describe("callbackNextPath (auth/callback)", () => {
  it("keeps a locale-prefixed app path", () => {
    expect(callbackNextPath("/en/projects/abc")).toBe("/en/projects/abc");
    expect(callbackNextPath("/ar/projects/abc/studio?step=parts")).toBe("/ar/projects/abc/studio?step=parts");
  });

  it("rejects API paths, protocol-relative and absolute URLs, and the sign-in page", () => {
    for (const bad of ["/api/x", "/api/auth/claim-guest", "//evil", "//evil.example/en/x", "https://evil", "/en/sign-in", "/\\evil", "/en/x\ny", "/projects/abc"]) {
      expect(callbackNextPath(bad), bad).toBe("/");
    }
  });

  it("falls back to / for a missing or non-string value", () => {
    expect(callbackNextPath(null)).toBe("/");
    expect(callbackNextPath(undefined)).toBe("/");
    expect(callbackNextPath(["/en/x"])).toBe("/");
  });

  it("still lets the password-recovery link land on exactly /{locale}/reset-password", () => {
    expect(callbackNextPath("/en/reset-password")).toBe("/en/reset-password");
    expect(callbackNextPath("/ar/reset-password/")).toBe("/ar/reset-password");
    expect(callbackNextPath("/en/reset-password/../../api/x")).toBe("/");
    expect(callbackNextPath("/en/sign-up")).toBe("/");
  });
});
