import { describe, expect, it } from "vitest";

import {
  VIDEOS,
  VIDEO_FILES,
  VIDEO_SLUGS,
  canAutoplay,
  isoDuration,
  videoBase,
  videoFileNames,
  videoJsonLd,
  videoSources,
  videoVersionSuffix,
} from "./videos";

describe("video registry", () => {
  it("has one entry per slug; all six clips are published", () => {
    expect(VIDEOS.map((v) => v.slug)).toEqual([...VIDEO_SLUGS]);
    expect(VIDEOS.filter((v) => v.published).map((v) => v.slug)).toEqual([
      "idea-to-kit",
      "file-to-part",
      "sketch-to-drawing",
      "wiring-check",
      "cad-model",
      "store-to-door",
    ]);
    expect(VIDEOS.filter((v) => v.published).every((v) => v.uploadDate === "2026-10-10")).toBe(true);
    expect(VIDEOS.map((v) => v.durationSeconds)).toEqual([45, 35, 33, 31, 31, 40]);
  });

  it("every slug has exactly five file names with the right extensions", () => {
    expect([...VIDEO_FILES]).toEqual(["mp4", "webm", "jpg", "en.vtt", "ar.vtt"]);
    for (const slug of VIDEO_SLUGS) {
      const names = videoFileNames(slug);
      expect(names).toHaveLength(5);
      expect(names).toEqual([
        `${slug}.mp4`,
        `${slug}.webm`,
        `${slug}.jpg`,
        `${slug}.en.vtt`,
        `${slug}.ar.vtt`,
      ]);
    }
  });

  it("message keys follow the slug", () => {
    for (const v of VIDEOS) {
      expect(v.titleKey).toBe(`${v.slug}Title`);
      expect(v.captionKey).toBe(`${v.slug}Caption`);
      expect(v.descriptionKey).toBe(`${v.slug}Description`);
    }
  });
});

describe("urls", () => {
  it("builds the public bucket base and the five sources", () => {
    const base = videoBase("https://abc.supabase.co/");
    expect(base).toBe("https://abc.supabase.co/storage/v1/object/public/videos");
    const s = videoSources(base, "cad-model");
    const v = "?v=2026-10-10";
    expect(s.mp4).toBe(`${base}/cad-model/cad-model.mp4${v}`);
    expect(s.webm).toBe(`${base}/cad-model/cad-model.webm${v}`);
    expect(s.poster).toBe(`${base}/cad-model/cad-model.jpg${v}`);
    expect(s.captions).toEqual({
      en: `${base}/cad-model/cad-model.en.vtt${v}`,
      ar: `${base}/cad-model/cad-model.ar.vtt${v}`,
    });
  });

  it("published clips carry ?v=<uploadDate> on every file URL, placeholders do not", () => {
    const base = videoBase("https://abc.supabase.co");
    const pub = videoSources(base, "idea-to-kit");
    expect(pub.mp4).toBe(`${base}/idea-to-kit/idea-to-kit.mp4?v=2026-10-10`);
    expect(pub.webm).toBe(`${base}/idea-to-kit/idea-to-kit.webm?v=2026-10-10`);
    expect(pub.poster).toBe(`${base}/idea-to-kit/idea-to-kit.jpg?v=2026-10-10`);
    expect(pub.captions.en).toBe(`${base}/idea-to-kit/idea-to-kit.en.vtt?v=2026-10-10`);
    expect(pub.captions.ar).toBe(`${base}/idea-to-kit/idea-to-kit.ar.vtt?v=2026-10-10`);
    for (const v of VIDEOS) {
      const urls = Object.values(videoSources(base, v.slug)).flatMap((u) =>
        typeof u === "string" ? [u] : Object.values(u),
      );
      expect(urls.every((u) => u.includes("?v=") === v.published)).toBe(true);
    }
    expect(videoVersionSuffix("no-such-clip")).toBe("");
  });
});

describe("canAutoplay", () => {
  const ok = { reducedMotion: false, inView: true, missing: false, posterOnly: false };
  it("is true only in view with nothing against it", () => {
    expect(canAutoplay(ok)).toBe(true);
  });
  it("is false under reduced motion, out of view, missing or poster-only", () => {
    expect(canAutoplay({ ...ok, reducedMotion: true })).toBe(false);
    expect(canAutoplay({ ...ok, inView: false })).toBe(false);
    expect(canAutoplay({ ...ok, missing: true })).toBe(false);
    expect(canAutoplay({ ...ok, posterOnly: true })).toBe(false);
  });
});

describe("videoJsonLd", () => {
  it("emits a VideoObject with the required fields", () => {
    const entry = VIDEOS[0];
    const base = videoBase("https://abc.supabase.co");
    const ld = videoJsonLd({ entry, base, name: "Name", description: "Desc.", locale: "en" });
    expect(ld["@context"]).toBe("https://schema.org");
    expect(ld["@type"]).toBe("VideoObject");
    expect(ld.name).toBe("Name");
    expect(ld.description).toBe("Desc.");
    expect(ld.thumbnailUrl).toBe(`${base}/idea-to-kit/idea-to-kit.jpg?v=2026-10-10`);
    expect(ld.contentUrl).toBe(`${base}/idea-to-kit/idea-to-kit.mp4?v=2026-10-10`);
    expect(ld.uploadDate).toBe("2026-10-10");
    expect(ld.duration).toBe("PT45S");
    expect(ld.inLanguage).toBe("en");
  });

  it("formats ISO 8601 durations", () => {
    expect(isoDuration(45)).toBe("PT45S");
    expect(isoDuration(60)).toBe("PT1M");
    expect(isoDuration(90)).toBe("PT1M30S");
    expect(isoDuration(3600)).toBe("PT1H");
  });
});
