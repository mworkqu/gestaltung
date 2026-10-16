import { describe, expect, it } from "vitest";

import {
  cancelRetire,
  capRetire,
  dueRetirements,
  markRetire,
  parseRetireList,
  queueRetire,
  removeSiteLink,
  RETIRE_GRACE_HOURS,
  RETIRE_MAX,
  type RetireEntry,
} from "./youtube-retire";
import { parseYoutubeMeta, type YoutubeMeta } from "./youtube-upload";

const OLD = "aaaaaaaaaaa";
const NEW = "bbbbbbbbbbb";
const OTHER = "ccccccccccc";
const now = new Date("2026-10-17T07:00:00.000Z");

const meta = (over: Partial<YoutubeMeta> = {}): YoutubeMeta => ({
  channel_id: "",
  channel_title: "",
  quota: null,
  uploads: {},
  retire: [],
  ...over,
});

const entry = (id: string, over: Partial<RetireEntry> = {}): RetireEntry => ({
  video_id: id,
  reason: "manual",
  queued_at: "2026-10-01T00:00:00.000Z",
  delete_after: "2026-10-03T00:00:00.000Z",
  status: "queued",
  ...over,
});

describe("parseRetireList", () => {
  it("old rows without a retire list parse to []", () => {
    expect(parseYoutubeMeta({ channel_title: "x" }).retire).toEqual([]);
    expect(parseRetireList("junk")).toEqual([]);
  });
  it("drops bad ids, bad dates and repeats; cleans fields", () => {
    const list = parseRetireList([
      { video_id: OLD, reason: "replaced", queued_at: "2026-10-01T00:00:00Z", delete_after: "2026-10-03T00:00:00Z", status: "weird", title: "  T  ", replaced_by: NEW, error: "e".repeat(300) },
      { video_id: OLD, queued_at: "2026-10-01T00:00:00Z", delete_after: "2026-10-03T00:00:00Z" },
      { video_id: "short", queued_at: "2026-10-01T00:00:00Z", delete_after: "2026-10-03T00:00:00Z" },
      { video_id: OTHER, queued_at: "nope", delete_after: "2026-10-03T00:00:00Z" },
      null,
    ]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ video_id: OLD, reason: "replaced", status: "queued", title: "T", replaced_by: NEW });
    expect(list[0].error).toHaveLength(200);
  });
});

describe("queueRetire", () => {
  it("queues with the grace period", () => {
    const r = queueRetire(meta(), { video_id: OLD, title: "Old", reason: "replaced", replaced_by: NEW }, now);
    expect(r.outcome).toBe("queued");
    expect(r.meta.retire).toEqual([
      {
        video_id: OLD,
        title: "Old",
        reason: "replaced",
        replaced_by: NEW,
        queued_at: now.toISOString(),
        delete_after: new Date(now.getTime() + RETIRE_GRACE_HOURS * 3_600_000).toISOString(),
        status: "queued",
      },
    ]);
  });
  it("ignores duplicates that are queued, failed or deleted", () => {
    for (const status of ["queued", "failed", "deleted"] as const) {
      const m = meta({ retire: [entry(OLD, { status })] });
      const r = queueRetire(m, { video_id: OLD, reason: "manual" }, now);
      expect(r.outcome).toBe("duplicate");
      expect(r.meta).toBe(m);
    }
  });
  it("queues a cancelled one again", () => {
    const r = queueRetire(meta({ retire: [entry(OLD, { status: "cancelled" })] }), { video_id: OLD, reason: "manual" }, now, 1);
    expect(r.outcome).toBe("queued");
    expect(r.meta.retire).toHaveLength(1);
    expect(r.meta.retire[0]).toMatchObject({ status: "queued", delete_after: "2026-10-17T08:00:00.000Z" });
  });
  it("never queues a clip's current upload, nor a bad id", () => {
    const m = meta({ uploads: { "idea-to-kit": { video_id: OLD, uploaded_at: "", privacy: "private", warnings: [] } } });
    expect(queueRetire(m, { video_id: OLD, reason: "manual" }, now).outcome).toBe("current");
    expect(queueRetire(m, { video_id: "nope", reason: "manual" }, now).outcome).toBe("bad_id");
  });
});

describe("capRetire", () => {
  it("drops the oldest deleted / cancelled entries first", () => {
    const id = (n: number) => `v${String(n).padStart(10, "0")}`;
    const list: RetireEntry[] = Array.from({ length: RETIRE_MAX + 2 }, (_, n) =>
      entry(id(n), {
        queued_at: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString(),
        status: n === 5 || n === 9 ? "deleted" : "queued",
      }),
    );
    const out = capRetire(list);
    expect(out).toHaveLength(RETIRE_MAX);
    expect(out.map((e) => e.video_id)).not.toContain(id(5));
    expect(out.map((e) => e.video_id)).not.toContain(id(9));
    expect(out[0].video_id).toBe(id(0));
  });
  it("then the oldest pending ones", () => {
    const list = Array.from({ length: RETIRE_MAX + 1 }, (_, n) =>
      entry(`v${String(n).padStart(10, "0")}`, { queued_at: new Date(Date.UTC(2026, 0, 1) + n * 60_000).toISOString() }),
    );
    expect(capRetire(list)[0].video_id).toBe("v0000000001");
  });
});

describe("due / mark / cancel", () => {
  const m = meta({
    retire: [
      entry(OLD),
      entry(NEW, { status: "failed", error: "403 forbidden" }),
      entry(OTHER, { delete_after: "2026-10-18T00:00:00.000Z" }),
      entry("ddddddddddd", { status: "deleted" }),
      entry("eeeeeeeeeee", { status: "cancelled" }),
    ],
  });
  it("due = queued or failed past delete_after", () => {
    expect(dueRetirements(m, now).map((e) => e.video_id)).toEqual([OLD, NEW]);
  });
  it("marks one entry and clears an emptied error", () => {
    const done = markRetire(m, NEW, { status: "deleted", deleted_at: now.toISOString(), error: "" });
    const e = done.retire.find((x) => x.video_id === NEW)!;
    expect(e).toMatchObject({ status: "deleted", deleted_at: now.toISOString() });
    expect("error" in e).toBe(false);
    expect(markRetire(m, "zzzzzzzzzzz", { status: "deleted" })).toBe(m);
  });
  it("cancels only pending entries", () => {
    expect(cancelRetire(m, OLD).retire[0].status).toBe("cancelled");
    expect(cancelRetire(m, NEW).retire[1]).not.toHaveProperty("error");
    expect(cancelRetire(m, "ddddddddddd")).toBe(m);
  });
});

describe("removeSiteLink", () => {
  const site = {
    channel_url: "https://www.youtube.com/@gestaltung",
    videos: [
      { id: OLD, title_en: "a", title_ar: "أ", kit_query: "" },
      { id: NEW, title_en: "b", title_ar: "ب", kit_query: "esp32" },
    ],
  };
  it("removes the video and keeps the rest", () => {
    const r = removeSiteLink(site, OLD);
    expect(r.changed).toBe(true);
    expect(r.value).toEqual({ channel_url: site.channel_url, videos: [site.videos[1]] });
  });
  it("reports no change when it is not listed", () => {
    expect(removeSiteLink(site, OTHER).changed).toBe(false);
    expect(removeSiteLink(null, OLD)).toEqual({ changed: false, value: { channel_url: "", videos: [] } });
  });
});
