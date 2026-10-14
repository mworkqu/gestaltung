// CAD Champions intro / how-to video slots (Prompt 4 Step E). Pure data plus
// the provider interface. Every slot starts as a placeholder; to publish a
// video set `provider` and `providerId` here (Prompt 9 adds Bunny Stream).
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

/**
 * Provider interface: the embed URL for a slot, or null when there is no real
 * video yet (placeholder, empty id, or Bunny before Prompt 9). YouTube uses
 * the privacy-enhanced youtube-nocookie.com domain; enablejsapi lets the
 * VideoSlot read playback progress for the 90%-watched rule.
 */
export function getPlaybackUrl(ref: VideoRef, opts: { origin?: string } = {}): string | null {
  if (ref.provider === "youtube" && YOUTUBE_ID.test(ref.providerId)) {
    const params = new URLSearchParams({ rel: "0", modestbranding: "1", enablejsapi: "1" });
    if (opts.origin) params.set("origin", opts.origin);
    return `https://www.youtube-nocookie.com/embed/${ref.providerId}?${params.toString()}`;
  }
  return null; // placeholder, missing id, or bunny (Prompt 9)
}

/** True when the slot plays a real video (so "watched" can be measured). */
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
