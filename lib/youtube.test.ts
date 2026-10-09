import { describe, expect, it } from "vitest";

import {
  cleanChannelUrl,
  extractVideoId,
  hasYoutubeEntries,
  kitHref,
  KIT_QUERY_MAX,
  parseYoutube,
  TITLE_MAX,
  toDraft,
  validateYoutube,
  videoTitle,
  videoUrl,
  YOUTUBE_MAX,
} from "./youtube";

const ID = "dQw4w9WgXcQ";
const video = (over: Record<string, unknown> = {}) => ({
  id: ID,
  title_en: "Line follower",
  title_ar: "متتبع الخط",
  kit_query: "line following",
  ...over,
});
const idN = (n: number) => `abcdefghi${String(n).padStart(2, "0")}`; // 11 chars

describe("extractVideoId", () => {
  it("accepts a bare 11-character id", () => {
    expect(extractVideoId(ID)).toBe(ID);
    expect(extractVideoId(`  ${ID}  `)).toBe(ID);
    expect(extractVideoId("a_b-c_d-e_f")).toBe("a_b-c_d-e_f");
  });
  it("reads watch, youtu.be, shorts, embed and live links", () => {
    expect(extractVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/watch?feature=share&v=${ID}&t=10s`)).toBe(ID);
    expect(extractVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`https://youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`https://youtu.be/${ID}`)).toBe(ID);
    expect(extractVideoId(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(extractVideoId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
  });
  it("accepts a link pasted without the scheme", () => {
    expect(extractVideoId(`www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(extractVideoId(`youtu.be/${ID}`)).toBe(ID);
  });
  it("rejects everything else", () => {
    for (const bad of [
      "",
      "   ",
      "short",
      "toolongtoolongtoolong",
      "abc!defghij",
      "https://example.com/watch?v=" + ID,
      "https://evil.com/youtu.be/" + ID,
      `https://www.youtube.com.evil.com/watch?v=${ID}`,
      "https://www.youtube.com/watch?v=short",
      "https://www.youtube.com/@handle",
      "javascript:alert(1)",
      `ftp://youtu.be/${ID}`,
      null,
      undefined,
      42,
      {},
    ]) {
      expect(extractVideoId(bad)).toBe("");
    }
  });
});

describe("cleanChannelUrl", () => {
  it("keeps https links on the three YouTube hosts", () => {
    expect(cleanChannelUrl("https://www.youtube.com/@gestaltung")).toBe("https://www.youtube.com/@gestaltung");
    expect(cleanChannelUrl("https://youtube.com/@gestaltung")).toBe("https://youtube.com/@gestaltung");
    expect(cleanChannelUrl("https://m.youtube.com/channel/UC1234567890abcdefghijkl")).toBe(
      "https://m.youtube.com/channel/UC1234567890abcdefghijkl",
    );
    expect(cleanChannelUrl("  https://www.youtube.com/@x  ")).toBe("https://www.youtube.com/@x");
  });
  it("rejects http, other hosts, lookalikes, credentials and bare hosts", () => {
    for (const bad of [
      "",
      "http://www.youtube.com/@x",
      "https://vimeo.com/x",
      "https://www.youtube.com.evil.com/@x",
      "https://evil.com/www.youtube.com/@x",
      "https://user:pw@www.youtube.com/@x",
      "https://www.youtube.com",
      "https://www.youtube.com/",
      "www.youtube.com/@x",
      "javascript:alert(1)",
      "https://www.youtube.com/@" + "x".repeat(300),
      null,
      7,
    ]) {
      expect(cleanChannelUrl(bad)).toBe("");
    }
  });
});

describe("links", () => {
  it("builds the watch link and the store search link", () => {
    expect(videoUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
    expect(kitHref("line following")).toBe("/store?q=line%20following");
    expect(kitHref("  led & strip ")).toBe("/store?q=led%20%26%20strip");
    expect(kitHref("اردوينو")).toBe(`/store?q=${encodeURIComponent("اردوينو")}`);
  });
});

describe("parseYoutube", () => {
  it("never throws, whatever the stored value is", () => {
    for (const bad of [null, undefined, 0, "x", true, [], [1, 2], { videos: "nope" }, { videos: [null, 3, "a"] }]) {
      expect(() => parseYoutube(bad)).not.toThrow();
      expect(parseYoutube(bad).videos).toEqual([]);
    }
    expect(parseYoutube({ channel_url: 5, videos: {} })).toEqual({ channel_url: "", videos: [] });
  });
  it("reads the seeded empty value", () => {
    const s = parseYoutube({ channel_url: "", videos: [] });
    expect(s).toEqual({ channel_url: "", videos: [] });
    expect(hasYoutubeEntries(s)).toBe(false);
  });
  it("keeps valid videos, trims text, and turns a pasted link into its id", () => {
    const s = parseYoutube({
      channel_url: " https://www.youtube.com/@gestaltung ",
      videos: [video({ id: `https://youtu.be/${ID}`, title_en: "  Line follower  ", kit_query: "  led  " })],
    });
    expect(s.channel_url).toBe("https://www.youtube.com/@gestaltung");
    expect(s.videos).toEqual([{ id: ID, title_en: "Line follower", title_ar: "متتبع الخط", kit_query: "led" }]);
  });
  it("drops invalid entries and keeps the rest", () => {
    const s = parseYoutube({
      videos: [
        video({ id: "bad" }),
        video({ id: idN(1), title_en: "" }),
        video({ id: idN(2), title_ar: "   " }),
        video({ id: idN(3), title_en: "x".repeat(TITLE_MAX + 1) }),
        video({ id: idN(4), kit_query: "q".repeat(KIT_QUERY_MAX + 1) }),
        "string",
        null,
        video({ id: idN(5) }),
      ],
    });
    expect(s.videos.map((v) => v.id)).toEqual([idN(5)]);
  });
  it("makes kit_query optional", () => {
    const s = parseYoutube({ videos: [{ id: ID, title_en: "A", title_ar: "ب" }, video({ id: idN(1), kit_query: undefined })] });
    expect(s.videos).toHaveLength(2);
    expect(s.videos.every((v) => v.kit_query === "")).toBe(true);
  });
  it("accepts titles of exactly the limit", () => {
    const s = parseYoutube({ videos: [video({ title_en: "x".repeat(TITLE_MAX), kit_query: "q".repeat(KIT_QUERY_MAX) })] });
    expect(s.videos).toHaveLength(1);
  });
  it("blanks a bad channel url but keeps the videos", () => {
    const s = parseYoutube({ channel_url: "http://youtube.com/@x", videos: [video()] });
    expect(s.channel_url).toBe("");
    expect(s.videos).toHaveLength(1);
  });
  it("drops a repeated id after the first", () => {
    const s = parseYoutube({ videos: [video(), video({ id: `https://youtu.be/${ID}`, title_en: "Other" })] });
    expect(s.videos).toHaveLength(1);
    expect(s.videos[0].title_en).toBe("Line follower");
  });
  it("cuts the list at the maximum", () => {
    const videos = Array.from({ length: YOUTUBE_MAX + 5 }, (_, i) => video({ id: idN(i) }));
    expect(parseYoutube({ videos }).videos).toHaveLength(YOUTUBE_MAX);
  });
});

describe("validateYoutube", () => {
  it("accepts an empty settings object", () => {
    expect(validateYoutube({ channel_url: "", videos: [] })).toEqual({ ok: true, value: { channel_url: "", videos: [] } });
    expect(validateYoutube({})).toEqual({ ok: true, value: { channel_url: "", videos: [] } });
  });
  it("returns the clean value (ids from links, trimmed text)", () => {
    const r = validateYoutube({
      channel_url: "https://www.youtube.com/@gestaltung",
      videos: [video({ id: `https://www.youtube.com/watch?v=${ID}`, title_en: " T " })],
    });
    expect(r).toEqual({
      ok: true,
      value: {
        channel_url: "https://www.youtube.com/@gestaltung",
        videos: [{ id: ID, title_en: "T", title_ar: "متتبع الخط", kit_query: "line following" }],
      },
    });
  });
  it("names the channel field with index -1", () => {
    const r = validateYoutube({ channel_url: "http://nope.example", videos: [] });
    expect(r).toEqual({ ok: false, errors: [{ index: -1, code: "channel_url" }] });
  });
  it("reports every bad field of a row with its index", () => {
    const r = validateYoutube({
      videos: [video(), video({ id: "bad", title_en: "", title_ar: "x".repeat(TITLE_MAX + 1), kit_query: "q".repeat(81) })],
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.every((e) => e.index === 1)).toBe(true);
    expect(r.errors.map((e) => e.code).sort()).toEqual(["id", "kit_query", "title_ar", "title_en"]);
  });
  it("flags an unreadable row and a non-array list", () => {
    expect(validateYoutube({ videos: [null] })).toEqual({ ok: false, errors: [{ index: 0, code: "row" }] });
    expect(validateYoutube({ videos: "x" })).toEqual({ ok: false, errors: [{ index: 0, code: "row" }] });
    expect(validateYoutube(null)).toEqual({ ok: false, errors: [{ index: 0, code: "row" }] });
    expect(validateYoutube([])).toEqual({ ok: false, errors: [{ index: 0, code: "row" }] });
  });
  it("flags a repeated video on the later row", () => {
    const r = validateYoutube({ videos: [video(), video({ id: `https://youtu.be/${ID}` })] });
    expect(r).toEqual({ ok: false, errors: [{ index: 1, code: "duplicate_id" }] });
  });
  it("allows exactly the maximum and flags one more", () => {
    const make = (n: number) => Array.from({ length: n }, (_, i) => video({ id: idN(i) }));
    expect(validateYoutube({ videos: make(YOUTUBE_MAX) }).ok).toBe(true);
    const over = validateYoutube({ videos: make(YOUTUBE_MAX + 1) });
    expect(over).toEqual({ ok: false, errors: [{ index: YOUTUBE_MAX, code: "row" }] });
  });
});

describe("hasYoutubeEntries", () => {
  it("is true for a channel or at least one video", () => {
    expect(hasYoutubeEntries({ channel_url: "", videos: [] })).toBe(false);
    expect(hasYoutubeEntries({ channel_url: "https://www.youtube.com/@x", videos: [] })).toBe(true);
    expect(hasYoutubeEntries({ channel_url: "", videos: parseYoutube({ videos: [video()] }).videos })).toBe(true);
    expect(hasYoutubeEntries(null)).toBe(false);
    expect(hasYoutubeEntries(undefined)).toBe(false);
  });
});

describe("videoTitle", () => {
  it("picks the locale and falls back to the other language", () => {
    const v = { title_en: "English", title_ar: "عربي" };
    expect(videoTitle(v, "en")).toBe("English");
    expect(videoTitle(v, "ar")).toBe("عربي");
    expect(videoTitle({ title_en: "English", title_ar: "" }, "ar")).toBe("English");
    expect(videoTitle({ title_en: "", title_ar: "" }, "en")).toBe("");
  });
});

describe("toDraft", () => {
  it("shows invalid stored entries so the owner can fix them", () => {
    const d = toDraft({ channel_url: "http://bad", videos: [{ id: "bad", title_en: 5, title_ar: "ب" }, null, "x"] });
    expect(d).toEqual({ channel_url: "http://bad", videos: [{ id: "bad", title_en: "", title_ar: "ب", kit_query: "" }] });
    expect(toDraft(null)).toEqual({ channel_url: "", videos: [] });
    expect(toDraft([])).toEqual({ channel_url: "", videos: [] });
  });
});
