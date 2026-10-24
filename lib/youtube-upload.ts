// Videos & YouTube (D6): pure rules for uploading the six feature clips to the
// owner's channel with the YouTube Data API v3.
//
//   - OAuth: authorization-code flow, offline access, prompt=consent, scopes
//     youtube.upload (videos.insert + thumbnails.set) AND youtube.force-ssl
//     (captions.insert and channels.list?mine accept only youtube.force-ssl /
//     youtubepartner; youtube.upload does not cover them).
//   - Metadata (title, EN + AR description, tags) generated from the slug and
//     the `Videos` copy, then edited by the owner before upload.
//   - Quota: 10,000 units/day by default; one full upload = videos.insert 1,600
//     + 2 x captions.insert 400 + thumbnails.set 50 = 2,450 units. Google resets
//     the quota at midnight PACIFIC time, so the counter is keyed by the Pacific
//     date (10:00 or 11:00 in Qatar), never by the Qatar date, so it can never
//     show more uploads left than Google allows.
//   - Resumable upload helpers (chunk ranges, the 308 Range header) and the
//     multipart/related body used by captions.insert.
//   - Merging an uploaded video id into store_settings.youtube (lib/youtube.ts
//     format, the one the site already reads).
//
// No env, no I/O, no React: unit-tested in lib/youtube-upload.test.ts.

import { parseYoutube, TITLE_MAX, YOUTUBE_MAX, type Youtube, type YoutubeVideo } from "@/lib/youtube";
import { parseRetireList } from "@/lib/youtube-retire";
import { PRIVACY, type Privacy, type QuotaState, type UploadRecord, type YoutubeMeta } from "@/lib/youtube-types";

// ── OAuth ────────────────────────────────────────────────────────────────────

export const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",
] as const;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const YT_INTEGRATION = "youtube";
export const STATE_COOKIE = "yt_oauth_state";
export const CALLBACK_PATH = "/api/admin/youtube/callback";

export const redirectUriFor = (origin: string): string => `${origin.replace(/\/+$/, "")}${CALLBACK_PATH}`;

export function buildAuthUrl(opts: { clientId: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: YT_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  return `${GOOGLE_AUTH_URL}?${q.toString()}`;
}

/** Did Google grant every scope we need? (`scope` = the token response's space-separated list.) */
export function hasAllScopes(scope: string | null | undefined): boolean {
  const got = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  return YT_SCOPES.every((s) => got.has(s));
}

// ── Quota ────────────────────────────────────────────────────────────────────

export const YT_DAILY_QUOTA = 10_000;
export const YT_COST = { insert: 1600, caption: 400, thumbnail: 50, channel: 1, delete: 50 } as const;
export const UPLOAD_COST = YT_COST.insert + 2 * YT_COST.caption + YT_COST.thumbnail;

const PACIFIC = "America/Los_Angeles";

/** The quota day: the calendar date in Pacific time ("YYYY-MM-DD"). */
export function quotaDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PACIFIC, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Pacific UTC offset in hours at `now` (-7 in summer, -8 in winter). */
export function pacificOffsetHours(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PACIFIC,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return Math.round((asUtc - Math.floor(now.getTime() / 60_000) * 60_000) / 3_600_000);
}

/** The hour (Qatar time, UTC+3, no DST) at which Google resets the quota: 10 or 11. */
export const quotaResetHourQatar = (now: Date): number => 3 - pacificOffsetHours(now);


export function quotaUsedToday(q: QuotaState | null | undefined, now: Date): number {
  if (!q || q.day !== quotaDay(now)) return 0;
  return Number.isFinite(q.used) && q.used > 0 ? Math.floor(q.used) : 0;
}

export function addQuota(q: QuotaState | null | undefined, units: number, now: Date): QuotaState {
  return { day: quotaDay(now), used: quotaUsedToday(q, now) + Math.max(0, Math.floor(units)) };
}

export function quotaSummary(q: QuotaState | null | undefined, now: Date) {
  const used = quotaUsedToday(q, now);
  const remaining = Math.max(0, YT_DAILY_QUOTA - used);
  return { used, remaining, uploadsLeft: Math.floor(remaining / UPLOAD_COST), resetHourQatar: quotaResetHourQatar(now) };
}

// ── Integration row metadata ─────────────────────────────────────────────────

export { PRIVACY };
export type { Privacy, UploadRecord, YoutubeMeta, QuotaState };

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const s = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/** Lenient read of integrations.metadata for the youtube row; never throws. */
export function parseYoutubeMeta(raw: unknown): YoutubeMeta {
  const out: YoutubeMeta = { channel_id: "", channel_title: "", quota: null, uploads: {}, retire: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  out.channel_id = s(r.channel_id);
  out.channel_title = s(r.channel_title);
  const q = r.quota as Record<string, unknown> | undefined;
  if (q && typeof q === "object" && typeof q.day === "string" && typeof q.used === "number") {
    out.quota = { day: q.day, used: q.used };
  }
  const ups = r.uploads;
  if (ups && typeof ups === "object" && !Array.isArray(ups)) {
    for (const [slug, v] of Object.entries(ups as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const u = v as Record<string, unknown>;
      if (typeof u.video_id !== "string" || !VIDEO_ID.test(u.video_id)) continue;
      out.uploads[slug] = {
        video_id: u.video_id,
        uploaded_at: s(u.uploaded_at, 40),
        privacy: (PRIVACY as readonly string[]).includes(u.privacy as string) ? (u.privacy as Privacy) : "private",
        warnings: Array.isArray(u.warnings) ? u.warnings.filter((w): w is string => typeof w === "string").slice(0, 8) : [],
      };
    }
  }
  out.retire = parseRetireList(r.retire);
  return out;
}

// ── Metadata from the slug ───────────────────────────────────────────────────

export const YT_TITLE_MAX = 100;
export const YT_DESCRIPTION_MAX_BYTES = 5000;
export const YT_TAGS_MAX_CHARS = 500;
export const YT_CATEGORY_SCIENCE_TECH = "28";

const BASE_TAGS = ["Gestaltung360", "Qatar", "Lusail", "prototyping", "product design", "قطر", "تصميم المنتجات"];

const SLUG_TAGS: Record<string, string[]> = {
  "idea-to-kit": ["parts list", "Arduino", "ESP32", "electronics kit"],
  "file-to-part": ["3D printing", "CNC", "laser cutting", "STEP file"],
  "sketch-to-drawing": ["CAD drawing", "technical drawing", "STEP"],
  "wiring-check": ["wiring diagram", "schematic", "electronics"],
  "cad-model": ["3D model", "enclosure", "CAD"],
  "store-to-door": ["electronics store", "delivery", "Doha"],
};

export type ClipCopy = { title: string; description: string };

export type UploadMeta = { title: string; description: string; tags: string[]; privacy: Privacy };

/** First route of the clip without a dynamic segment, e.g. "/how-it-works"; "" = home. */
export function publicPath(pages: readonly string[]): string {
  const p = pages.find((x) => !x.includes("["));
  return p === undefined || p === "/" ? "" : p;
}

/**
 * Default title / description / tags for a clip. Bilingual title when it fits
 * in 100 characters, else "<English> | Gestaltung360". Description: English,
 * link, Arabic title + description, Arabic link, footer line.
 */
export function defaultUploadMeta(opts: {
  slug: string;
  en: ClipCopy;
  ar: ClipCopy;
  siteUrl: string;
  pages: readonly string[];
  footer: string;
}): UploadMeta {
  const site = opts.siteUrl.replace(/\/+$/, "");
  const path = publicPath(opts.pages);
  const bilingual = `${opts.en.title} | ${opts.ar.title}`;
  const title = clipText(
    bilingual.length <= YT_TITLE_MAX ? bilingual : `${opts.en.title} | Gestaltung360`,
    YT_TITLE_MAX,
  );
  const description = [
    opts.en.description,
    `${site}/en${path}`,
    "",
    opts.ar.title,
    opts.ar.description,
    `${site}/ar${path}`,
    "",
    opts.footer,
  ]
    .join("\n")
    .replace(/[<>]/g, "");
  const words = opts.slug.split("-").filter((w) => w.length > 2 && w !== "and");
  const tags = fitTags([...BASE_TAGS, ...(SLUG_TAGS[opts.slug] ?? []), ...words]);
  return { title: title.replace(/[<>]/g, ""), description, tags, privacy: "private" };
}

const clipText = (t: string, max: number) => (t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…");

/** YouTube counts a tag with a space as if quoted (+2) and a comma between tags. */
export function tagsLength(tags: readonly string[]): number {
  return tags.reduce((n, t, i) => n + t.length + (/\s/.test(t) ? 2 : 0) + (i ? 1 : 0), 0);
}

/** Unique, trimmed, non-empty tags that fit in 500 characters (later ones are dropped). */
export function fitTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const t = raw.replace(/[<>,]/g, "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    if (tagsLength([...out, t]) > YT_TAGS_MAX_CHARS) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** "a, b , c" → ["a","b","c"]. */
export const splitTags = (text: string): string[] =>
  text
    .split(/[,\n،]/)
    .map((t) => t.trim())
    .filter(Boolean);

export type MetaError = "title" | "description" | "tags" | "privacy";

export function validateUploadMeta(raw: unknown): { ok: true; value: UploadMeta } | { ok: false; errors: MetaError[] } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const errors: MetaError[] = [];
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const description = typeof r.description === "string" ? r.description.trim() : "";
  const tags = Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter(Boolean) : [];
  const privacy = r.privacy;
  if (!title || title.length > YT_TITLE_MAX || /[<>]/.test(title)) errors.push("title");
  if (Buffer.byteLength(description, "utf8") > YT_DESCRIPTION_MAX_BYTES || /[<>]/.test(description)) errors.push("description");
  if (tagsLength(tags) > YT_TAGS_MAX_CHARS || tags.some((t) => /[<>,]/.test(t) || t.length > 100)) errors.push("tags");
  if (!(PRIVACY as readonly unknown[]).includes(privacy)) errors.push("privacy");
  return errors.length ? { ok: false, errors } : { ok: true, value: { title, description, tags, privacy: privacy as Privacy } };
}

// ── Resumable upload ─────────────────────────────────────────────────────────

/** 8 MiB: a multiple of 256 KiB, as YouTube requires for every chunk but the last. */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export const contentRange = (start: number, length: number, total: number): string =>
  `bytes ${start}-${start + length - 1}/${total}`;

/** Next byte to send after a 308: "bytes=0-1234" → 1235; no header → 0. */
export function nextOffsetFromRange(range: string | null | undefined): number {
  const m = /bytes=0-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

/** multipart/related body (JSON metadata part + one media part), as captions.insert wants it. */
export function multipartRelated(boundary: string, json: unknown, mime: string, data: Uint8Array): Buffer {
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(json)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  return Buffer.concat([Buffer.from(head, "utf8"), Buffer.from(data), Buffer.from(`\r\n--${boundary}--\r\n`, "utf8")]);
}

// ── store_settings.youtube ───────────────────────────────────────────────────

/**
 * The site's YouTube setting with `video` added (or replacing `replaceId`, the
 * clip's earlier upload, in place; its store search words are kept). Titles are
 * cut to 120 characters. Fails when the list is already full (12).
 */
export function withUploadedVideo(
  raw: unknown,
  video: { id: string; title_en: string; title_ar: string },
  replaceId?: string | null,
): { ok: true; value: Youtube } | { ok: false; reason: "full" | "bad_id" } {
  if (!VIDEO_ID.test(video.id)) return { ok: false, reason: "bad_id" };
  const cur = parseYoutube(raw);
  const entry: YoutubeVideo = {
    id: video.id,
    title_en: clipText(video.title_en.trim(), TITLE_MAX) || video.id,
    title_ar: clipText(video.title_ar.trim(), TITLE_MAX) || video.title_en.trim().slice(0, TITLE_MAX) || video.id,
    kit_query: "",
  };
  const at = cur.videos.findIndex((v) => v.id === video.id || (!!replaceId && v.id === replaceId));
  if (at >= 0) {
    entry.kit_query = cur.videos[at].kit_query;
    const videos = cur.videos.filter((v, i) => i === at || (v.id !== video.id && v.id !== replaceId));
    videos[videos.findIndex((v) => v === cur.videos[at])] = entry;
    return { ok: true, value: { ...cur, videos } };
  }
  if (cur.videos.length >= YOUTUBE_MAX) return { ok: false, reason: "full" };
  return { ok: true, value: { ...cur, videos: [...cur.videos, entry] } };
}
