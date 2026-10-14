import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VIDEO_SLOTS, getPlaybackUrl, hasRealPlayer, watchedFraction } from "./registry";

describe("video registry", () => {
  it("has unique keys and both titles", () => {
    const keys = VIDEO_SLOTS.map((v) => v.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const v of VIDEO_SLOTS) {
      expect(v.title_en.length).toBeGreaterThan(0);
      expect(v.title_ar.length).toBeGreaterThan(0);
      expect(v.page.startsWith("/")).toBe(true);
    }
  });

  it("lists every empty slot in docs/CONTENT_TODO.md", () => {
    const todo = fs.readFileSync(path.join(process.cwd(), "docs", "CONTENT_TODO.md"), "utf8");
    for (const v of VIDEO_SLOTS) {
      if (v.providerId === "") expect(todo).toContain(`[TODO-MO: record video: ${v.title_en}]`);
    }
  });
});

describe("getPlaybackUrl", () => {
  it("returns null for a placeholder or bunny (until Prompt 9)", () => {
    expect(getPlaybackUrl({ provider: "placeholder", providerId: "" })).toBeNull();
    expect(getPlaybackUrl({ provider: "bunny", providerId: "abc" })).toBeNull();
    expect(getPlaybackUrl({ provider: "youtube", providerId: "" })).toBeNull();
    expect(getPlaybackUrl({ provider: "youtube", providerId: "bad id!" })).toBeNull();
  });

  it("returns a privacy-enhanced YouTube embed with the JS API on", () => {
    const url = getPlaybackUrl({ provider: "youtube", providerId: "dQw4w9WgXcQ" }, { origin: "https://x.test" });
    expect(url).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/);
    expect(url).toContain("enablejsapi=1");
    expect(url).toContain("origin=https%3A%2F%2Fx.test");
    expect(hasRealPlayer({ provider: "youtube", providerId: "dQw4w9WgXcQ" })).toBe(true);
  });
});

describe("watchedFraction", () => {
  it("clamps and guards", () => {
    expect(watchedFraction(45, 50)).toBe(0.9);
    expect(watchedFraction(60, 50)).toBe(1);
    expect(watchedFraction(1, 0)).toBe(0);
    expect(watchedFraction("x", 50)).toBe(0);
  });
});
