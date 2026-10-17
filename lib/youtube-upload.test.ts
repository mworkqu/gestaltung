import { describe, expect, it } from "vitest";

import {
  addQuota,
  buildAuthUrl,
  contentRange,
  defaultUploadMeta,
  fitTags,
  hasAllScopes,
  multipartRelated,
  nextOffsetFromRange,
  pacificOffsetHours,
  parseYoutubeMeta,
  publicPath,
  quotaDay,
  quotaSummary,
  redirectUriFor,
  splitTags,
  tagsLength,
  UPLOAD_COST,
  validateUploadMeta,
  withUploadedVideo,
  YT_SCOPES,
} from "./youtube-upload";

describe("oauth", () => {
  it("builds an offline consent URL with both scopes", () => {
    const u = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://x.test/cb", state: "st" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("scope")).toBe(YT_SCOPES.join(" "));
  });
  it("redirect uri per origin", () => {
    expect(redirectUriFor("http://localhost:3000/")).toBe("http://localhost:3000/api/admin/youtube/callback");
  });
  it("checks granted scopes", () => {
    expect(hasAllScopes(YT_SCOPES.join(" "))).toBe(true);
    expect(hasAllScopes(YT_SCOPES[0])).toBe(false);
    expect(hasAllScopes(undefined)).toBe(false);
  });
});

describe("quota", () => {
  it("one upload costs 2,450 units", () => {
    expect(UPLOAD_COST).toBe(2450);
  });
  it("keys the day by Pacific time", () => {
    // 2026-10-11 05:00 UTC = 2026-10-10 22:00 PDT (Qatar 08:00 on the 11th).
    expect(quotaDay(new Date("2026-10-11T05:00:00Z"))).toBe("2026-10-10");
    expect(quotaDay(new Date("2026-10-11T08:00:00Z"))).toBe("2026-10-11");
  });
  it("Pacific offset and Qatar reset hour follow DST", () => {
    expect(pacificOffsetHours(new Date("2026-07-01T12:00:00Z"))).toBe(-7);
    expect(pacificOffsetHours(new Date("2026-12-01T12:00:00Z"))).toBe(-8);
    expect(quotaSummary(null, new Date("2026-07-01T12:00:00Z")).resetHourQatar).toBe(10);
    expect(quotaSummary(null, new Date("2026-12-01T12:00:00Z")).resetHourQatar).toBe(11);
  });
  it("adds within a day and resets on a new one", () => {
    const t1 = new Date("2026-10-11T08:00:00Z");
    const q = addQuota(addQuota(null, 1600, t1), 850, t1);
    expect(q.used).toBe(2450);
    expect(quotaSummary(q, t1)).toMatchObject({ used: 2450, remaining: 7550, uploadsLeft: 3 });
    const t2 = new Date("2026-10-12T08:00:00Z");
    expect(quotaSummary(q, t2)).toMatchObject({ used: 0, remaining: 10000, uploadsLeft: 4 });
    expect(addQuota(q, 1, t2)).toEqual({ day: "2026-10-12", used: 1 });
  });
  it("never goes below zero remaining", () => {
    const t = new Date("2026-10-11T08:00:00Z");
    expect(quotaSummary(addQuota(null, 12000, t), t)).toMatchObject({ remaining: 0, uploadsLeft: 0 });
  });
});

describe("parseYoutubeMeta", () => {
  it("is lenient and drops bad uploads", () => {
    expect(parseYoutubeMeta(null)).toEqual({ channel_id: "", channel_title: "", quota: null, uploads: {}, retire: [] });
    const m = parseYoutubeMeta({
      channel_title: "Gestaltung",
      quota: { day: "2026-10-11", used: 5 },
      uploads: {
        "idea-to-kit": { video_id: "dQw4w9WgXcQ", uploaded_at: "x", privacy: "weird", warnings: ["thumbnail", 3] },
        "cad-model": { video_id: "short" },
      },
    });
    expect(m.channel_title).toBe("Gestaltung");
    expect(m.quota).toEqual({ day: "2026-10-11", used: 5 });
    expect(Object.keys(m.uploads)).toEqual(["idea-to-kit"]);
    expect(m.uploads["idea-to-kit"]).toMatchObject({ privacy: "private", warnings: ["thumbnail"] });
  });
});

describe("metadata", () => {
  const base = {
    slug: "idea-to-kit",
    en: { title: "From one sentence to a parts list", description: "A short walkthrough." },
    ar: { title: "من جملة واحدة إلى قائمة قطع", description: "جولة قصيرة." },
    siteUrl: "https://gestaltung360.com/",
    pages: ["/", "/how-it-works"],
    footer: "Gestaltung360 · Lusail, Qatar",
  };
  it("bilingual title, both descriptions and links, private by default", () => {
    const m = defaultUploadMeta(base);
    expect(m.title).toBe("From one sentence to a parts list | من جملة واحدة إلى قائمة قطع");
    expect(m.description).toContain("A short walkthrough.");
    expect(m.description).toContain("جولة قصيرة.");
    expect(m.description).toContain("https://gestaltung360.com/en\n");
    expect(m.description).toContain("https://gestaltung360.com/ar\n");
    expect(m.privacy).toBe("private");
    expect(m.tags).toContain("Gestaltung360");
    expect(m.tags).toContain("Arduino");
    expect(validateUploadMeta(m).ok).toBe(true);
  });
  it("falls back to English + brand when the bilingual title is too long", () => {
    const m = defaultUploadMeta({ ...base, en: { ...base.en, title: "x".repeat(80) } });
    expect(m.title).toBe(`${"x".repeat(80)} | Gestaltung360`);
  });
  it("skips dynamic routes for the link", () => {
    expect(publicPath(["/projects/[id]/prototyping"])).toBe("");
    expect(publicPath(["/projects/[id]", "/design"])).toBe("/design");
  });
  it("tags: YouTube length rule and the 500 cap", () => {
    expect(tagsLength(["a b", "c"])).toBe(7);
    const many = Array.from({ length: 80 }, (_, i) => `tag number ${i}`);
    expect(tagsLength(fitTags(many))).toBeLessThanOrEqual(500);
    expect(fitTags(["A", "a", " ", "x,y"])).toEqual(["A", "xy"]);
    expect(splitTags("a, b ,، c\nd")).toEqual(["a", "b", "c", "d"]);
  });
  it("validation codes", () => {
    const r = validateUploadMeta({ title: "", description: "<b>", tags: ["x".repeat(600)], privacy: "secret" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sort()).toEqual(["description", "privacy", "tags", "title"]);
  });
});

describe("resumable + multipart", () => {
  it("content ranges and 308 offsets", () => {
    expect(contentRange(0, 10, 25)).toBe("bytes 0-9/25");
    expect(contentRange(20, 5, 25)).toBe("bytes 20-24/25");
    expect(nextOffsetFromRange("bytes=0-8388607")).toBe(8388608);
    expect(nextOffsetFromRange(null)).toBe(0);
  });
  it("builds a multipart/related body", () => {
    const body = multipartRelated("BB", { a: 1 }, "text/vtt", Buffer.from("WEBVTT")).toString("utf8");
    expect(body).toBe(
      '--BB\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"a":1}\r\n--BB\r\nContent-Type: text/vtt\r\n\r\nWEBVTT\r\n--BB--\r\n',
    );
  });
});

describe("withUploadedVideo", () => {
  const v = (id: string, kit = "") => ({ id, title_en: `T ${id}`, title_ar: `ع ${id}`, kit_query: kit });
  it("appends to the list", () => {
    const r = withUploadedVideo({ channel_url: "", videos: [] }, { id: "AAAAAAAAAAA", title_en: "En", title_ar: "Ar" });
    expect(r).toEqual({ ok: true, value: { channel_url: "", videos: [{ id: "AAAAAAAAAAA", title_en: "En", title_ar: "Ar", kit_query: "" }] } });
  });
  it("replaces the clip's earlier upload in place and keeps its search words", () => {
    const raw = { channel_url: "", videos: [v("AAAAAAAAAAA"), v("OLDOLDOLDOL", "arduino"), v("CCCCCCCCCCC")] };
    const r = withUploadedVideo(raw, { id: "NEWNEWNEWNE", title_en: "En", title_ar: "Ar" }, "OLDOLDOLDOL");
    expect(r.ok && r.value.videos.map((x) => x.id)).toEqual(["AAAAAAAAAAA", "NEWNEWNEWNE", "CCCCCCCCCCC"]);
    expect(r.ok && r.value.videos[1].kit_query).toBe("arduino");
  });
  it("re-saving the same id does not duplicate", () => {
    const raw = { channel_url: "", videos: [v("AAAAAAAAAAA")] };
    const r = withUploadedVideo(raw, { id: "AAAAAAAAAAA", title_en: "New", title_ar: "جديد" });
    expect(r.ok && r.value.videos).toHaveLength(1);
    expect(r.ok && r.value.videos[0].title_en).toBe("New");
  });
  it("refuses when full or with a bad id", () => {
    const full = { channel_url: "", videos: Array.from({ length: 12 }, (_, i) => v(`ID${String(i).padStart(9, "0")}`)) };
    expect(withUploadedVideo(full, { id: "ZZZZZZZZZZZ", title_en: "a", title_ar: "b" })).toEqual({ ok: false, reason: "full" });
    expect(withUploadedVideo(null, { id: "bad", title_en: "a", title_ar: "b" })).toEqual({ ok: false, reason: "bad_id" });
  });
  it("cuts long titles to 120", () => {
    const r = withUploadedVideo(null, { id: "AAAAAAAAAAA", title_en: "x".repeat(200), title_ar: "" });
    expect(r.ok && r.value.videos[0].title_en.length).toBe(120);
    expect(r.ok && r.value.videos[0].title_ar.length).toBe(120);
  });
});
