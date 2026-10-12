import { describe, expect, it } from "vitest";

import { isStudioProject, projectHref, studioRedirectPath } from "./href";

describe("isStudioProject", () => {
  it("is true for AI consent, a studio version, or a studio doc", () => {
    expect(isStudioProject({ ai_consent: { at: "2026-10-12" } })).toBe(true);
    expect(isStudioProject({ spec: { aiConsent: { at: "x" } } })).toBe(true);
    expect(isStudioProject({ studio_version: 3 })).toBe(true);
    expect(isStudioProject({ studio: { lastStep: "parts" } })).toBe(true);
  });
  it("is false for drawing, CAD-file and store lists", () => {
    expect(isStudioProject({})).toBe(false);
    expect(isStudioProject({ studio_version: 0, ai_consent: null, spec: null, studio: null })).toBe(false);
    expect(isStudioProject({ studio_version: null, spec: { aiConsent: null } })).toBe(false);
  });
});

describe("projectHref", () => {
  it("opens product projects in the Studio and the rest on the project page", () => {
    expect(projectHref({ id: "a", studio_version: 1 })).toBe("/projects/a/studio");
    expect(projectHref({ id: "b", ai_consent: { at: "x" } })).toBe("/projects/b/studio");
    expect(projectHref({ id: "c" })).toBe("/projects/c");
  });
});

describe("studioRedirectPath", () => {
  it("keeps the query string", () => {
    expect(studioRedirectPath("en", "a", {})).toBe("/en/projects/a/studio");
    expect(studioRedirectPath("ar", "a", { getItMade: "1", step: "make" })).toBe("/ar/projects/a/studio?getItMade=1&step=make");
    expect(studioRedirectPath("en", "a", { x: ["1", "2"], y: undefined })).toBe("/en/projects/a/studio?x=1&x=2");
  });
});
