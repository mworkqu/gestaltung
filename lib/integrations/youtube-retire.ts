// Videos & YouTube: the retire worker. SERVER ONLY (service client, OAuth
// token). Called by the daily cron (app/api/cron/youtube-retire) for every due
// entry of the retire log (lib/youtube-retire.ts), and by "Delete now" in the
// dashboard for one entry (onlyIds, grace period ignored).
//
// Per entry: videos.delete (50 units; youtube.force-ssl covers it). 204 or 404
// (already gone) = deleted; anything else = failed with a short error, retried
// on the next run. Stops when less than 50 units are left today or Google no
// longer accepts the saved connection. Deleted videos are then removed from
// store_settings.youtube (the site's links). Every status change goes through
// updateYoutubeMeta, so a parallel upload's record is never overwritten.

import { revalidateStorefront } from "@/lib/cache/storefront";
import {
  accessTokenFor,
  readYoutubeIntegration,
  TokenRevokedError,
  updateYoutubeMeta,
  youtubeConfig,
} from "@/lib/integrations/youtube-server";
import { YOUTUBE_KEY } from "@/lib/youtube";
import { dueRetirements, markRetire, removeSiteLink } from "@/lib/youtube-retire";
import { addQuota, quotaSummary, YT_COST, type YoutubeMeta } from "@/lib/youtube-upload";

export type RetireStop = "setup" | "migration" | "db" | "not_connected" | "reconnect" | "google" | "quota";

export type RetireSummary = { deleted: number; failed: number; skipped: number; stopped?: RetireStop };

const VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";

export async function runRetirements(opts: { onlyIds?: string[]; now?: Date } = {}): Promise<RetireSummary> {
  const now = opts.now ?? new Date();
  const summary: RetireSummary = { deleted: 0, failed: 0, skipped: 0 };

  const c = youtubeConfig();
  if (!c.ok) return { ...summary, stopped: "setup" };
  const read = await readYoutubeIntegration();
  if (read.state === "no_table") return { ...summary, stopped: "migration" };
  if (read.state !== "ok") return { ...summary, stopped: "db" };
  const db = read.db;
  let state: YoutubeMeta = read.meta;

  const due = opts.onlyIds
    ? state.retire.filter((e) => opts.onlyIds!.includes(e.video_id) && (e.status === "queued" || e.status === "failed"))
    : dueRetirements(state, now);
  if (!due.length) return summary;
  if (!read.row?.refresh_token_enc) return { ...summary, skipped: due.length, stopped: "not_connected" };

  let token: string;
  try {
    token = await accessTokenFor(read.row, c.cfg);
  } catch (e) {
    console.error("[youtube-retire] token refresh failed:", e instanceof Error ? e.message : "unknown");
    return { ...summary, skipped: due.length, stopped: e instanceof TokenRevokedError ? "reconnect" : "google" };
  }

  const deletedIds: string[] = [];
  for (let i = 0; i < due.length; i++) {
    const id = due[i].video_id;
    if (quotaSummary(state.quota, new Date()).remaining < YT_COST.delete) {
      summary.skipped += due.length - i;
      summary.stopped = "quota";
      break;
    }
    // Never delete a clip's current upload (it may have been made current after queueing).
    if (Object.values(state.uploads).some((u) => u.video_id === id)) {
      state = await updateYoutubeMeta(db, state, (m) => markRetire(m, id, { status: "cancelled", error: "current_upload" }));
      summary.skipped++;
      continue;
    }

    let status = 0;
    let reason = "";
    try {
      const res = await fetch(`${VIDEOS_URL}?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      status = res.status;
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[] } };
        reason = err.error?.errors?.[0]?.reason ?? "";
      }
    } catch (e) {
      reason = e instanceof Error ? e.name : "network";
    }

    const gone = (status >= 200 && status < 300) || status === 404; // 204 = deleted, 404 = already gone
    const at = new Date().toISOString();
    state = await updateYoutubeMeta(db, state, (m) => {
      const counted = status ? { ...m, quota: addQuota(m.quota, YT_COST.delete, new Date()) } : m;
      return gone
        ? markRetire(counted, id, { status: "deleted", deleted_at: at, error: "" })
        : markRetire(counted, id, { status: "failed", error: `${status || "network"} ${reason}`.trim() });
    });
    if (gone) {
      summary.deleted++;
      deletedIds.push(id);
    } else {
      // 403 forbidden / insufficientPermissions = not this channel's video; 401 = token.
      console.error("[youtube-retire] delete failed:", id, status, reason);
      summary.failed++;
      if (reason === "quotaExceeded") {
        summary.skipped += due.length - i - 1;
        summary.stopped = "quota";
        break;
      }
    }
  }

  if (deletedIds.length) {
    const { data, error } = await db.from("store_settings").select("value").eq("key", YOUTUBE_KEY).maybeSingle();
    if (error) console.error("[youtube-retire] site links read failed:", error.message);
    else {
      let value: unknown = data?.value;
      let changed = false;
      for (const id of deletedIds) {
        const r = removeSiteLink(value, id);
        if (r.changed) {
          value = r.value;
          changed = true;
        }
      }
      if (changed) {
        const { error: upErr } = await db
          .from("store_settings")
          .upsert({ key: YOUTUBE_KEY, value, updated_at: new Date().toISOString() });
        if (upErr) console.error("[youtube-retire] site links save failed:", upErr.message);
        else revalidateStorefront();
      }
    }
  }
  return summary;
}
