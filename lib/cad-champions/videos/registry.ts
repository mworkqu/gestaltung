// CAD Champions intro / how-to video slots (Prompt 4 Step E). Pure data plus
// the provider interface. Every slot starts as a placeholder; to publish a
// video set `provider` and `providerId` here (YouTube id, a Bunny Stream
// GUID served through GET /api/cad-champions/video/intro:<key>, or a "file"
// clip self-hosted in the public `videos` bucket, see FILE_VIDEOS).
// Each empty slot is listed in docs/CONTENT_TODO.md as
// "[TODO-MO: record video: <title>]" (videos test keeps the two in sync).

import type { Locale } from "@/i18n/routing";
import { videoBase } from "@/lib/videos";

export type VideoProvider = "placeholder" | "youtube" | "bunny" | "file";

export interface VideoRef {
  provider: VideoProvider;
  /**
   * YouTube video id (11 chars), Bunny video GUID, or a FILE_VIDEOS key
   * (provider "file"); "" while not recorded.
   */
  providerId: string;
}

/**
 * Self-hosted clips in the public Supabase bucket `videos` (same layout as the
 * site's feature videos, lib/videos.ts), one cut per language:
 *   videos/<id>-<locale>/<id>-<locale>.{mp4,webm,jpg,en.vtt,ar.vtt}
 * `version` = upload date; it is added as ?v= to every URL (the bucket serves
 * a one-year cache), so a re-upload must bump it. Made with
 * scripts/record-videos/cc (tts.py -> record.mjs -> edit.mjs, steps in the
 * record.mjs header) and uploaded with scripts/upload-video.mjs.
 */
export const FILE_VIDEOS = {
  "cc-intro": { version: "2026-10-16", durationSeconds: { en: 179, ar: 235 } },
} as const satisfies Record<string, { version: string; durationSeconds: Record<Locale, number> }>;

export type FileVideoId = keyof typeof FILE_VIDEOS;

export function isFileVideoId(id: string): id is FileVideoId {
  return Object.prototype.hasOwnProperty.call(FILE_VIDEOS, id);
}

export interface FileVideoSources {
  mp4: string;
  webm: string;
  poster: string;
  captions: Record<Locale, string>;
}

/**
 * URLs of a self-hosted clip for one page language (the Arabic cut on /ar,
 * the English cut on /en); both caption files are offered on both cuts.
 * `supabaseUrl` = NEXT_PUBLIC_SUPABASE_URL. null for an unknown id or no URL.
 */
export function fileVideoSources(id: string, locale: Locale, supabaseUrl: string | undefined): FileVideoSources | null {
  if (!isFileVideoId(id) || !supabaseUrl) return null;
  const slug = `${id}-${locale}`;
  const v = `?v=${FILE_VIDEOS[id].version}`;
  const file = (ext: string) => `${videoBase(supabaseUrl)}/${slug}/${slug}.${ext}${v}`;
  return { mp4: file("mp4"), webm: file("webm"), poster: file("jpg"), captions: { en: file("en.vtt"), ar: file("ar.vtt") } };
}

export interface VideoSlotDef extends VideoRef {
  key: string;
  title_en: string;
  title_ar: string;
  /** The page the slot appears on (CC path). */
  page: string;
}

export const VIDEO_SLOTS = [
  {
    key: "get_ready_welcome",
    title_en: "What is the competition and what is this test?",
    title_ar: "ما هي المسابقة وما هو هذا الاختبار؟",
    page: "/get-ready",
    // The CAD Champions walkthrough (also on the landing page); an admin
    // override (youtube:<id>, a Bunny GUID or file:<id>) still replaces it.
    provider: "file",
    providerId: "cc-intro",
  },
  {
    key: "install_inventor",
    title_en: "Install Autodesk Inventor with a free education licence",
    title_ar: "ثبّت Autodesk Inventor برخصة تعليمية مجانية",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "install_fusion",
    title_en: "Install Autodesk Fusion with a free education licence",
    title_ar: "ثبّت Autodesk Fusion برخصة تعليمية مجانية",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "install_solidworks",
    title_en: "Getting SOLIDWORKS as a student",
    title_ar: "الحصول على SOLIDWORKS كطالب",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "action_units_mm",
    title_en: "Set your units to millimetres",
    title_ar: "اضبط الوحدات على المليمتر",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "action_material_density",
    title_en: "Set the material and density",
    title_ar: "اضبط المادة والكثافة",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "action_export_step",
    title_en: "Export a STEP file",
    title_ar: "صدّر ملف STEP",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "action_export_pdf",
    title_en: "Export a drawing as PDF",
    title_ar: "صدّر الرسم بصيغة PDF",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
  {
    key: "action_find_upload",
    title_en: "Find your exported files and upload them",
    title_ar: "اعثر على ملفاتك المصدَّرة وارفعها",
    page: "/get-ready",
    provider: "placeholder",
    providerId: "",
  },
] as const satisfies readonly VideoSlotDef[];

export type VideoKey = (typeof VIDEO_SLOTS)[number]["key"];

export function getVideoSlot(key: VideoKey): VideoSlotDef {
  return VIDEO_SLOTS.find((v) => v.key === key)!;
}

export function videoTitle(slot: Pick<VideoSlotDef, "title_en" | "title_ar">, locale: Locale): string {
  return locale === "ar" ? slot.title_ar : slot.title_en;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const BUNNY_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A stored video id (cc_lessons.video_*, cc_exercises.solution_video_id) as a
 * VideoRef: "youtube:<11-char id>" = YouTube, a GUID = Bunny Stream, anything
 * else (empty) = placeholder.
 */
export function parseStoredVideo(value: string | null | undefined): VideoRef {
  const v = (value ?? "").trim();
  if (v.toLowerCase().startsWith("youtube:")) {
    const id = v.slice(8).trim();
    return YOUTUBE_ID.test(id) ? { provider: "youtube", providerId: id } : { provider: "placeholder", providerId: "" };
  }
  if (BUNNY_GUID.test(v)) return { provider: "bunny", providerId: v };
  return { provider: "placeholder", providerId: "" };
}

/**
 * An admin-stored value for an intro SLOT (cc_content_overrides "video:<key>"):
 * everything parseStoredVideo accepts, plus "file:<FILE_VIDEOS key>". Lessons
 * and help articles keep using parseStoredVideo (no self-hosted files there).
 */
export function parseSlotVideo(value: string | null | undefined): VideoRef {
  const v = (value ?? "").trim();
  if (v.toLowerCase().startsWith("file:")) {
    const id = v.slice(5).trim();
    return isFileVideoId(id) ? { provider: "file", providerId: id } : { provider: "placeholder", providerId: "" };
  }
  return parseStoredVideo(v);
}

/** Signs a Bunny video id (server only: lib/cad-champions/videos/bunny.ts signBunnyEmbed). */
export type BunnySigner = (videoId: string) => { url: string; expires: number } | null;

export interface PlaybackOptions {
  /** Page origin, sent to YouTube for the JS API. */
  origin?: string;
  /**
   * The signed-in viewer. Bunny links are only signed for a user whose access
   * the caller has already checked (the video route); null = no Bunny URL.
   */
  user?: { id: string } | null;
  /** Server-side signer; without it Bunny refs return null (client code). */
  signBunny?: BunnySigner;
}

/**
 * Provider interface getPlaybackUrl(videoRef, { user, ... }): the embed URL,
 * or null when there is no real video (placeholder, empty id) or it cannot be
 * signed here. Dispatches placeholder | youtube | bunny. YouTube uses the
 * privacy-enhanced youtube-nocookie.com domain; enablejsapi lets the player
 * read playback progress for the 90%-watched rule. Bunny needs a user and the
 * server signer (2-hour token, lib/cad-champions/videos/bunny.ts). "file"
 * clips have no embed URL: they play in a <video> (fileVideoSources).
 */
export function getPlaybackUrl(ref: VideoRef, opts: PlaybackOptions = {}): string | null {
  switch (ref.provider) {
    case "youtube": {
      if (!YOUTUBE_ID.test(ref.providerId)) return null;
      const params = new URLSearchParams({ rel: "0", modestbranding: "1", enablejsapi: "1" });
      if (opts.origin) params.set("origin", opts.origin);
      return `https://www.youtube-nocookie.com/embed/${ref.providerId}?${params.toString()}`;
    }
    case "bunny": {
      if (!opts.user || !opts.signBunny || !BUNNY_GUID.test(ref.providerId)) return null;
      return opts.signBunny(ref.providerId)?.url ?? null;
    }
    default:
      return null;
  }
}

/** True when the slot plays a real video without signing (so "watched" can be measured on Get Ready). */
export function hasRealPlayer(ref: VideoRef): boolean {
  if (ref.provider === "file") return isFileVideoId(ref.providerId);
  return getPlaybackUrl(ref) !== null;
}

/** Fraction watched from YouTube player info (0..1). */
export function watchedFraction(currentTime: unknown, duration: unknown): number {
  const c = typeof currentTime === "number" ? currentTime : NaN;
  const d = typeof duration === "number" ? duration : NaN;
  if (!Number.isFinite(c) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0, Math.min(1, c / d));
}

export const WATCHED_THRESHOLD = 0.9;
