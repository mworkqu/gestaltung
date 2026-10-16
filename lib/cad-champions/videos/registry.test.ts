import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FILE_VIDEOS,
  VIDEO_SLOTS,
  fileVideoSources,
  getPlaybackUrl,
  getVideoSlot,
  hasRealPlayer,
  parseSlotVideo,
  parseStoredVideo,
  watchedFraction,
} from "./registry";
import { resolveSlotRef } from "./slot-override";

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
  it("returns null for a placeholder, and for bunny without a user + server signer", () => {
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

describe("bunny dispatch", () => {
  const guid = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
  const signer = (id: string) => ({ url: `https://iframe.mediadelivery.net/embed/1/${id}?token=t&expires=1`, expires: 1 });

  it("signs only with a user and a signer", () => {
    expect(getPlaybackUrl({ provider: "bunny", providerId: guid }, { signBunny: signer })).toBeNull();
    expect(getPlaybackUrl({ provider: "bunny", providerId: guid }, { user: { id: "u" } })).toBeNull();
    expect(getPlaybackUrl({ provider: "bunny", providerId: guid }, { user: { id: "u" }, signBunny: signer })).toContain(`/embed/1/${guid}?token=`);
    expect(getPlaybackUrl({ provider: "bunny", providerId: "not-a-guid" }, { user: { id: "u" }, signBunny: signer })).toBeNull();
  });

  it("parses stored ids", () => {
    expect(parseStoredVideo(guid)).toEqual({ provider: "bunny", providerId: guid });
    expect(parseStoredVideo("youtube:dQw4w9WgXcQ")).toEqual({ provider: "youtube", providerId: "dQw4w9WgXcQ" });
    expect(parseStoredVideo("youtube:bad")).toEqual({ provider: "placeholder", providerId: "" });
    expect(parseStoredVideo(null)).toEqual({ provider: "placeholder", providerId: "" });
    expect(parseStoredVideo("  ")).toEqual({ provider: "placeholder", providerId: "" });
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

describe("file provider (self-hosted clips)", () => {
  const base = "https://x.supabase.co";

  it("the welcome slot plays the walkthrough", () => {
    const slot = getVideoSlot("get_ready_welcome");
    expect(slot).toMatchObject({ provider: "file", providerId: "cc-intro" });
    expect(hasRealPlayer(slot)).toBe(true);
    expect(getPlaybackUrl(slot)).toBeNull(); // no embed URL: it plays in a <video>
  });

  it("builds the per-language URLs with the version", () => {
    const v = FILE_VIDEOS["cc-intro"].version;
    const ar = fileVideoSources("cc-intro", "ar", `${base}/`)!;
    expect(ar.mp4).toBe(`${base}/storage/v1/object/public/videos/cc-intro-ar/cc-intro-ar.mp4?v=${v}`);
    expect(ar.poster).toContain("/cc-intro-ar/cc-intro-ar.jpg?v=");
    expect(ar.captions.en).toContain("/cc-intro-ar/cc-intro-ar.en.vtt?v=");
    expect(fileVideoSources("cc-intro", "en", base)!.webm).toContain("/cc-intro-en/cc-intro-en.webm?v=");
    expect(fileVideoSources("nope", "en", base)).toBeNull();
    expect(fileVideoSources("cc-intro", "en", undefined)).toBeNull();
  });

  it("slot overrides accept file:<id>; lessons do not", () => {
    expect(parseSlotVideo("file:cc-intro")).toEqual({ provider: "file", providerId: "cc-intro" });
    expect(parseSlotVideo("FILE: cc-intro")).toEqual({ provider: "file", providerId: "cc-intro" });
    expect(parseSlotVideo("file:unknown")).toEqual({ provider: "placeholder", providerId: "" });
    expect(parseSlotVideo("youtube:dQw4w9WgXcQ")).toEqual({ provider: "youtube", providerId: "dQw4w9WgXcQ" });
    expect(parseStoredVideo("file:cc-intro")).toEqual({ provider: "placeholder", providerId: "" });
    expect(hasRealPlayer({ provider: "file", providerId: "unknown" })).toBe(false);
  });

  it("an admin override still replaces the walkthrough", () => {
    const slot = getVideoSlot("get_ready_welcome");
    expect(resolveSlotRef(slot, "youtube:dQw4w9WgXcQ")).toEqual({ provider: "youtube", providerId: "dQw4w9WgXcQ" });
    expect(resolveSlotRef(slot, "")).toEqual({ provider: "file", providerId: "cc-intro" });
    expect(resolveSlotRef(slot, "junk")).toEqual({ provider: "file", providerId: "cc-intro" });
  });
});
