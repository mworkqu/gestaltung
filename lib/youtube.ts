// YouTube links (P4-05 / WF-36). store_settings.youtube (seeded by migration
// 0059, edited in Dashboard → Store → YouTube links) holds the studio channel
// and a short list of videos:
//
//   { channel_url: string, videos: [{ id, title_en, title_ar, kit_query }] }
//
//   channel_url  https on youtube.com / www.youtube.com / m.youtube.com, else ""
//   id           the 11-character video id; a pasted watch / youtu.be / shorts
//                link is reduced to its id
//   title_*      one line each, <= 120 characters, both required
//   kit_query    optional store search words, <= 80 characters; the "Get the
//                parts" link (/store?q=…) only shows when it is set
//
// LINKS ONLY: the site never embeds a video, loads a YouTube script or shows a
// YouTube thumbnail. Pure (no Next runtime, no I/O): tested in lib/youtube.test.ts.
// The public read is getYoutube() in lib/store/public-catalog.ts.

export const YOUTUBE_KEY = "youtube";
export const YOUTUBE_MAX = 12;
export const TITLE_MAX = 120;
export const KIT_QUERY_MAX = 80;
export const CHANNEL_URL_MAX = 200;

export type YoutubeVideo = {
  id: string;
  title_en: string;
  title_ar: string;
  kit_query: string;
};

export type Youtube = {
  channel_url: string;
  videos: YoutubeVideo[];
};

export const EMPTY_YOUTUBE: Youtube = { channel_url: "", videos: [] };

// ── Links ────────────────────────────────────────────────────────────────────

const ID_RE = /^[A-Za-z0-9_-]{11}$/;
const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * A video id from a pasted value: a bare 11-character id, or a watch?v= /
 * youtu.be/ / shorts/ link (also /embed/ and /live/). "" when none.
 */
export function extractVideoId(input: unknown): string {
  const s = str(input);
  if (!s) return "";
  if (ID_RE.test(s)) return s;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const host = url.hostname.toLowerCase();
  let id = "";
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (YT_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "watch") id = url.searchParams.get("v") ?? "";
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? "";
  }
  return ID_RE.test(id) ? id : "";
}

/** A clean https YouTube channel / profile URL, or "" when it is not one. */
export function cleanChannelUrl(input: unknown): string {
  const s = str(input);
  if (!s || s.length > CHANNEL_URL_MAX) return "";
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" || !YT_HOSTS.has(url.hostname.toLowerCase())) return "";
  if (url.username || url.password) return "";
  // A bare youtube.com is not a channel.
  if (url.pathname.replace(/\//g, "") === "") return "";
  return url.toString();
}

/** The video page. Only called with a validated id. */
export const videoUrl = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** Locale-less store path for "Get the parts". */
export const kitHref = (query: string): string => `/store?q=${encodeURIComponent(query.trim())}`;

// ── Parse / validate ─────────────────────────────────────────────────────────

export type YoutubeErrorCode = "channel_url" | "id" | "title_en" | "title_ar" | "kit_query" | "duplicate_id" | "row";

/** index -1 = the channel URL field; otherwise the video row. */
export type YoutubeError = { index: number; code: YoutubeErrorCode };

function checkVideo(raw: unknown): { ok: true; value: YoutubeVideo } | { ok: false; codes: YoutubeErrorCode[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, codes: ["row"] };
  const r = raw as Record<string, unknown>;
  const codes: YoutubeErrorCode[] = [];
  const id = extractVideoId(r.id);
  if (!id) codes.push("id");
  const title_en = str(r.title_en);
  const title_ar = str(r.title_ar);
  const kit_query = str(r.kit_query);
  if (!title_en || title_en.length > TITLE_MAX) codes.push("title_en");
  if (!title_ar || title_ar.length > TITLE_MAX) codes.push("title_ar");
  if (kit_query.length > KIT_QUERY_MAX) codes.push("kit_query");
  if (codes.length) return { ok: false, codes };
  return { ok: true, value: { id, title_en, title_ar, kit_query } };
}

/**
 * Public read: the stored value → a clean Youtube. Invalid videos (and repeated
 * ids after the first) are dropped, a bad channel URL becomes ""; never throws.
 * More than YOUTUBE_MAX videos are cut.
 */
export function parseYoutube(raw: unknown): Youtube {
  try {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { channel_url: "", videos: [] };
    const r = raw as Record<string, unknown>;
    const videos: YoutubeVideo[] = [];
    const seen = new Set<string>();
    if (Array.isArray(r.videos)) {
      for (const item of r.videos) {
        const v = checkVideo(item);
        if (!v.ok || seen.has(v.value.id)) continue;
        seen.add(v.value.id);
        videos.push(v.value);
        if (videos.length >= YOUTUBE_MAX) break;
      }
    }
    return { channel_url: cleanChannelUrl(r.channel_url), videos };
  } catch {
    return { channel_url: "", videos: [] };
  }
}

/** Admin save: every field must be valid; errors name the row (index) and the field. */
export function validateYoutube(raw: unknown): { ok: true; value: Youtube } | { ok: false; errors: YoutubeError[] } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ index: 0, code: "row" }] };
  const r = raw as Record<string, unknown>;
  const errors: YoutubeError[] = [];

  const channelRaw = str(r.channel_url);
  const channel_url = cleanChannelUrl(channelRaw);
  if (channelRaw && !channel_url) errors.push({ index: -1, code: "channel_url" });

  const list = r.videos;
  const videos: YoutubeVideo[] = [];
  if (list !== undefined && !Array.isArray(list)) {
    errors.push({ index: 0, code: "row" });
  } else {
    const seen = new Set<string>();
    (list ?? []).forEach((item, index) => {
      const v = checkVideo(item);
      if (!v.ok) {
        for (const code of v.codes) errors.push({ index, code });
        return;
      }
      if (seen.has(v.value.id)) errors.push({ index, code: "duplicate_id" });
      seen.add(v.value.id);
      videos.push(v.value);
    });
    if ((list ?? []).length > YOUTUBE_MAX) errors.push({ index: YOUTUBE_MAX, code: "row" });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { channel_url, videos } };
}

/** Does the section have anything to show? (A channel link or at least one video.) */
export const hasYoutubeEntries = (s: Pick<Youtube, "channel_url" | "videos"> | null | undefined): boolean =>
  !!s && (!!s.channel_url || s.videos.length > 0);

/** The title for the locale; falls back to the other language, then "". */
export const videoTitle = (v: Pick<YoutubeVideo, "title_en" | "title_ar">, locale: string): string =>
  (locale === "ar" ? v.title_ar || v.title_en : v.title_en || v.title_ar) || "";

// ── Admin editor rows ────────────────────────────────────────────────────────

/** One editor row: every field is text; `id` may hold a pasted link. */
export type YoutubeDraftVideo = { id: string; title_en: string; title_ar: string; kit_query: string };
export type YoutubeDraft = { channel_url: string; videos: YoutubeDraftVideo[] };

export const emptyVideoDraft = (): YoutubeDraftVideo => ({ id: "", title_en: "", title_ar: "", kit_query: "" });

/**
 * The stored value → editor draft, leniently (an entry that would not pass
 * validation still shows, so the owner can fix it instead of losing it).
 */
export function toDraft(raw: unknown): YoutubeDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { channel_url: "", videos: [] };
  const r = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const videos = Array.isArray(r.videos)
    ? r.videos
        .filter((v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v))
        .map((v) => ({ id: s(v.id), title_en: s(v.title_en), title_ar: s(v.title_ar), kit_query: s(v.kit_query) }))
    : [];
  return { channel_url: s(r.channel_url), videos };
}
