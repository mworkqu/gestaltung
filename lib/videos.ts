// Registry + pure helpers for the self-hosted feature videos (CC-2).
//
// Six short clips live in the public Supabase bucket `videos` (migration 0049):
//   videos/<slug>/<slug>.mp4 | .webm | .jpg (poster 1280x720) | .en.vtt | .ar.vtt
// Nothing here reads env or touches React, so it is unit-tested
// (lib/videos.test.ts). The player is components/feature-video.tsx.

export const VIDEO_SLUGS = [
  "idea-to-kit",
  "file-to-part",
  "sketch-to-drawing",
  "wiring-check",
  "cad-model",
  "store-to-door",
] as const;

export type VideoSlug = (typeof VIDEO_SLUGS)[number];

export type FeatureVideoEntry = {
  slug: VideoSlug;
  /** Keys in the `Videos` message namespace. */
  titleKey: `${VideoSlug}Title`;
  captionKey: `${VideoSlug}Caption`;
  /** One sentence, used for the VideoObject JSON-LD. */
  descriptionKey: `${VideoSlug}Description`;
  /** Route paths (no locale prefix) where the clip appears. */
  pages: readonly string[];
  durationSeconds: number;
  /** ISO date of the real upload; update together with `published`. */
  uploadDate: string;
  /**
   * false until the owner has uploaded the real clip. Gates the JSON-LD (a
   * VideoObject must describe a real, playable video). Placeholders and
   * not-yet-uploaded files never emit structured data.
   */
  published: boolean;
};

/** `uploaded` = ISO date of the real upload; it also marks the clip published. */
function entry(
  slug: VideoSlug,
  pages: readonly string[],
  durationSeconds: number,
  uploaded?: string,
): FeatureVideoEntry {
  return {
    slug,
    titleKey: `${slug}Title`,
    captionKey: `${slug}Caption`,
    descriptionKey: `${slug}Description`,
    pages,
    durationSeconds,
    uploadDate: uploaded ?? "2026-10-08",
    published: uploaded !== undefined,
  };
}

export const VIDEOS: readonly FeatureVideoEntry[] = [
  // Recorded from the live site as a guest and uploaded 2026-10-10
  // (scripts/record-videos/). wiring-check and cad-model need a signed-in
  // account with credits, so they stay unpublished placeholders.
  entry("idea-to-kit", ["/", "/how-it-works"], 45, "2026-10-10"),
  entry("file-to-part", ["/", "/how-it-works", "/design"], 35, "2026-10-10"),
  entry("sketch-to-drawing", ["/design", "/design/drawing"], 33, "2026-10-10"),
  entry("wiring-check", ["/projects/[id]/prototyping"], 42),
  entry("cad-model", ["/projects/[id]/prototyping"], 40),
  entry("store-to-door", ["/", "/how-it-works"], 40, "2026-10-10"),
];

export function videoEntry(slug: string): FeatureVideoEntry | undefined {
  return VIDEOS.find((v) => v.slug === slug);
}

/** The five files of a clip, as extensions after `<slug>.`. */
export const VIDEO_FILES = ["mp4", "webm", "jpg", "en.vtt", "ar.vtt"] as const;

export type VideoFile = (typeof VIDEO_FILES)[number];

export const VIDEO_BUCKET = "videos";

export const VIDEO_CONTENT_TYPES: Record<VideoFile, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  jpg: "image/jpeg",
  "en.vtt": "text/vtt",
  "ar.vtt": "text/vtt",
};

/** File names inside `videos/<slug>/`. */
export function videoFileNames(slug: string): string[] {
  return VIDEO_FILES.map((ext) => `${slug}.${ext}`);
}

/** Public base URL of the bucket (no trailing slash). */
export function videoBase(supabaseUrl: string | undefined): string {
  return `${(supabaseUrl ?? "").replace(/\/+$/, "")}/storage/v1/object/public/${VIDEO_BUCKET}`;
}

export type VideoSources = {
  mp4: string;
  webm: string;
  poster: string;
  captions: { en: string; ar: string };
};

/**
 * Cache-busting suffix for a clip. Files in the bucket are served with a
 * one-year cache and replaced at the SAME URL when the real clip is uploaded,
 * so a published entry carries `?v=<uploadDate>` on every file URL (Supabase
 * ignores the query). Re-uploading a clip = bump its uploadDate. Unpublished
 * placeholders get no suffix.
 */
export function videoVersionSuffix(slug: string): string {
  const e = videoEntry(slug);
  return e?.published ? `?v=${e.uploadDate}` : "";
}

export function videoSources(base: string, slug: string): VideoSources {
  const v = videoVersionSuffix(slug);
  const file = (ext: VideoFile) => `${base}/${slug}/${slug}.${ext}${v}`;
  return {
    mp4: file("mp4"),
    webm: file("webm"),
    poster: file("jpg"),
    captions: { en: file("en.vtt"), ar: file("ar.vtt") },
  };
}

/**
 * Autoplay only when the clip is at least half in view and nothing argues
 * against it: reduced motion, a missing file, or a poster-only slot (the
 * workspace empty states play on click).
 */
export function canAutoplay(opts: {
  reducedMotion: boolean;
  inView: boolean;
  missing: boolean;
  posterOnly: boolean;
}): boolean {
  return opts.inView && !opts.reducedMotion && !opts.missing && !opts.posterOnly;
}

/** 45 -> "PT45S", 90 -> "PT1M30S", 3600 -> "PT1H". */
export function isoDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s === 0) return "PT0S";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${sec ? `${sec}S` : ""}`;
}

export type VideoObjectJsonLd = {
  "@context": "https://schema.org";
  "@type": "VideoObject";
  name: string;
  description: string;
  thumbnailUrl: string;
  contentUrl: string;
  uploadDate: string;
  duration: string;
  inLanguage: string;
};

export function videoJsonLd(opts: {
  entry: FeatureVideoEntry;
  base: string;
  name: string;
  description: string;
  locale: string;
}): VideoObjectJsonLd {
  const src = videoSources(opts.base, opts.entry.slug);
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: opts.name,
    description: opts.description,
    thumbnailUrl: src.poster,
    contentUrl: src.mp4,
    uploadDate: opts.entry.uploadDate,
    duration: isoDuration(opts.entry.durationSeconds),
    inLanguage: opts.locale === "ar" ? "ar" : "en",
  };
}
