// CAD Champions intro / how-to video slots (Prompt 4 Step E). Pure data plus
// the provider interface. Every slot starts as a placeholder; to publish a
// video set `provider` and `providerId` here (YouTube id, or a Bunny Stream
// GUID, served through GET /api/cad-champions/video/intro:<key>).
// Each empty slot is listed in docs/CONTENT_TODO.md as
// "[TODO-MO: record video: <title>]" (videos test keeps the two in sync).

import type { Locale } from "@/i18n/routing";

export type VideoProvider = "placeholder" | "youtube" | "bunny";

export interface VideoRef {
  provider: VideoProvider;
  /** YouTube video id (11 chars) or Bunny video GUID; "" while not recorded. */
  providerId: string;
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
    provider: "placeholder",
    providerId: "",
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
 * server signer (2-hour token, lib/cad-champions/videos/bunny.ts).
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
