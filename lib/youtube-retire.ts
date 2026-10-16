// Videos & YouTube: the retire log. Outdated videos on the owner's channel are
// listed in integrations.metadata.retire (youtube row, no extra table) and,
// RETIRE_GRACE_HOURS after they are listed, deleted from YouTube (videos.delete,
// 50 units) and removed from store_settings.youtube by the daily cron
// (lib/integrations/youtube-retire.ts). The owner can cancel one until then.
//
//   - "replaced": queued by the upload route when a clip is uploaded again
//   - "manual":   added from the dashboard (a pasted link or id)
//
// A video that is the CURRENT upload of any clip is never queued. Pure (no env,
// no I/O): unit-tested in lib/youtube-retire.test.ts.

import { parseYoutube, type Youtube } from "@/lib/youtube";
import type { YoutubeMeta } from "@/lib/youtube-upload";

export const RETIRE_GRACE_HOURS = 48;
export const RETIRE_MAX = 100;
export const RETIRE_TITLE_MAX = 120;
export const RETIRE_ERROR_MAX = 200;

export const RETIRE_STATUS = ["queued", "deleted", "failed", "cancelled"] as const;
export type RetireStatus = (typeof RETIRE_STATUS)[number];
export const RETIRE_REASON = ["replaced", "manual"] as const;
export type RetireReason = (typeof RETIRE_REASON)[number];

export type RetireEntry = {
  video_id: string;
  title?: string;
  reason: RetireReason;
  queued_at: string;
  delete_after: string;
  status: RetireStatus;
  deleted_at?: string;
  error?: string;
  replaced_by?: string;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v.slice(0, 40) : "");

/** Lenient read of metadata.retire; old rows without it (or junk) give []. */
export function parseRetireList(raw: unknown): RetireEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: RetireEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.video_id !== "string" || !VIDEO_ID.test(r.video_id) || seen.has(r.video_id)) continue;
    const queued_at = iso(r.queued_at);
    const delete_after = iso(r.delete_after);
    if (!queued_at || !delete_after) continue;
    const e: RetireEntry = {
      video_id: r.video_id,
      reason: (RETIRE_REASON as readonly unknown[]).includes(r.reason) ? (r.reason as RetireReason) : "manual",
      queued_at,
      delete_after,
      status: (RETIRE_STATUS as readonly unknown[]).includes(r.status) ? (r.status as RetireStatus) : "queued",
    };
    if (typeof r.title === "string" && r.title.trim()) e.title = r.title.trim().slice(0, RETIRE_TITLE_MAX);
    if (iso(r.deleted_at)) e.deleted_at = iso(r.deleted_at);
    if (typeof r.error === "string" && r.error) e.error = r.error.slice(0, RETIRE_ERROR_MAX);
    if (typeof r.replaced_by === "string" && VIDEO_ID.test(r.replaced_by)) e.replaced_by = r.replaced_by;
    seen.add(e.video_id);
    out.push(e);
  }
  return capRetire(out);
}

/**
 * At most RETIRE_MAX entries: the oldest deleted / cancelled ones go first;
 * only if the list is still too long do the oldest pending ones go.
 */
export function capRetire(list: RetireEntry[]): RetireEntry[] {
  if (list.length <= RETIRE_MAX) return list;
  const byAge = list.map((e, i) => ({ e, i })).sort((a, b) => a.e.queued_at.localeCompare(b.e.queued_at) || a.i - b.i);
  const done = byAge.filter((x) => x.e.status === "deleted" || x.e.status === "cancelled");
  const pending = byAge.filter((x) => x.e.status !== "deleted" && x.e.status !== "cancelled");
  const drop = new Set<number>();
  for (const x of [...done, ...pending]) {
    if (list.length - drop.size <= RETIRE_MAX) break;
    drop.add(x.i);
  }
  return list.filter((_, i) => !drop.has(i));
}

/** Video ids that are the current upload of some clip (never deleted). */
const currentIds = (meta: YoutubeMeta) => new Set(Object.values(meta.uploads).map((u) => u.video_id));

export type QueueOutcome = "queued" | "duplicate" | "current" | "bad_id";

/**
 * Add a video to the retire log, to be deleted `graceHours` from `now`. An
 * entry already queued / failed / deleted is left as it is ("duplicate"); a
 * cancelled one is queued again.
 */
export function queueRetire(
  meta: YoutubeMeta,
  v: { video_id: string; title?: string | null; reason: RetireReason; replaced_by?: string | null },
  now: Date,
  graceHours: number = RETIRE_GRACE_HOURS,
): { meta: YoutubeMeta; outcome: QueueOutcome } {
  if (!VIDEO_ID.test(v.video_id)) return { meta, outcome: "bad_id" };
  if (currentIds(meta).has(v.video_id)) return { meta, outcome: "current" };
  const prev = meta.retire.find((e) => e.video_id === v.video_id);
  if (prev && prev.status !== "cancelled") return { meta, outcome: "duplicate" };
  const entry: RetireEntry = {
    video_id: v.video_id,
    reason: v.reason,
    queued_at: now.toISOString(),
    delete_after: new Date(now.getTime() + Math.max(0, graceHours) * 3_600_000).toISOString(),
    status: "queued",
  };
  const title = (v.title ?? "").trim().slice(0, RETIRE_TITLE_MAX);
  if (title) entry.title = title;
  if (v.replaced_by && VIDEO_ID.test(v.replaced_by)) entry.replaced_by = v.replaced_by;
  const rest = meta.retire.filter((e) => e.video_id !== v.video_id);
  return { meta: { ...meta, retire: capRetire([...rest, entry]) }, outcome: "queued" };
}

/** Entries the worker should try now: queued or failed (retried), past delete_after. */
export function dueRetirements(meta: YoutubeMeta, now: Date): RetireEntry[] {
  const t = now.getTime();
  return meta.retire.filter((e) => (e.status === "queued" || e.status === "failed") && Date.parse(e.delete_after) <= t);
}

/** Change one entry (by video id); an unknown id leaves the meta unchanged. */
export function markRetire(
  meta: YoutubeMeta,
  videoId: string,
  patch: Partial<Pick<RetireEntry, "status" | "deleted_at" | "error">>,
): YoutubeMeta {
  if (!meta.retire.some((e) => e.video_id === videoId)) return meta;
  return {
    ...meta,
    retire: meta.retire.map((e) => {
      if (e.video_id !== videoId) return e;
      const next: RetireEntry = { ...e, ...patch };
      if (next.error) next.error = next.error.slice(0, RETIRE_ERROR_MAX);
      else delete next.error;
      if (!next.deleted_at) delete next.deleted_at;
      return next;
    }),
  };
}

/** Keep the video: only a pending (queued or failed) entry can be cancelled. */
export function cancelRetire(meta: YoutubeMeta, videoId: string): YoutubeMeta {
  const e = meta.retire.find((x) => x.video_id === videoId);
  if (!e || (e.status !== "queued" && e.status !== "failed")) return meta;
  return markRetire(meta, videoId, { status: "cancelled", error: "" });
}

/** store_settings.youtube without `videoId`; `changed` = false when it was not listed. */
export function removeSiteLink(raw: unknown, videoId: string): { changed: boolean; value: Youtube } {
  const cur = parseYoutube(raw);
  const videos = cur.videos.filter((v) => v.id !== videoId);
  return { changed: videos.length !== cur.videos.length, value: { ...cur, videos } };
}
