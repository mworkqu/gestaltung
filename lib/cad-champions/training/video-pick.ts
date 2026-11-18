// Which lesson video to show (COMPETITION_ALIGNMENT section A). PURE, tested.
//
// Each lesson has up to eight slots: inventor / fusion / solidworks / neutral
// x en / ar (cc_lessons.video_<track>_<lang>). Software-neutral lessons use
// the neutral pair. Order:
//   1. neutral, same language          (no note)
//   2. neutral, other language         (note: other_language)
//   3. the student's track, same language
//   4. the student's track, other language   (note: other_language)
//   5. Inventor, same language          (note: inventor_fallback)
//   6. anything recorded                (note: any_fallback)
//   none recorded -> slot null (the player shows "video coming soon")

import type { CcTrackSoftware } from "../db/types";

export type VideoTrack = CcTrackSoftware | "neutral";
export type VideoLang = "en" | "ar";
export type SlotKey = `${VideoTrack}_${VideoLang}`;

export const SLOT_KEYS: readonly SlotKey[] = [
  "neutral_en",
  "neutral_ar",
  "inventor_en",
  "inventor_ar",
  "fusion_en",
  "fusion_ar",
  "solidworks_en",
  "solidworks_ar",
];

export type LessonVideos = Partial<Record<SlotKey, string | null>>;

export type PickNote = "other_language" | "inventor_fallback" | "any_fallback" | null;

export interface VideoPick {
  slot: SlotKey | null;
  /** The stored value of that slot (Bunny GUID or "youtube:<id>"). */
  value: string | null;
  track: VideoTrack | null;
  lang: VideoLang | null;
  note: PickNote;
}

/** The video slots of a lesson row (columns video_<track>_<lang>). */
export function lessonVideos(row: Partial<Record<`video_${SlotKey}`, string | null>>): LessonVideos {
  const out: LessonVideos = {};
  for (const k of SLOT_KEYS) {
    const v = row[`video_${k}`];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export function isSlotKey(value: unknown): value is SlotKey {
  return typeof value === "string" && (SLOT_KEYS as readonly string[]).includes(value);
}

function has(videos: LessonVideos, key: SlotKey): boolean {
  const v = videos[key];
  return typeof v === "string" && v.trim().length > 0;
}

export function pickVideoSlot(videos: LessonVideos, track: CcTrackSoftware | null | undefined, locale: VideoLang): VideoPick {
  const t: CcTrackSoftware = track ?? "inventor";
  const other: VideoLang = locale === "ar" ? "en" : "ar";
  const order: { key: SlotKey; note: PickNote }[] = [
    { key: `neutral_${locale}`, note: null },
    { key: `neutral_${other}`, note: "other_language" },
    { key: `${t}_${locale}`, note: null },
    { key: `${t}_${other}`, note: "other_language" },
  ];
  if (t !== "inventor") order.push({ key: `inventor_${locale}`, note: "inventor_fallback" });
  for (const o of order) {
    if (has(videos, o.key)) return result(videos, o.key, o.note);
  }
  for (const key of SLOT_KEYS) {
    if (has(videos, key)) return result(videos, key, "any_fallback");
  }
  return { slot: null, value: null, track: null, lang: null, note: null };
}

function result(videos: LessonVideos, key: SlotKey, note: PickNote): VideoPick {
  const [track, lang] = key.split("_") as [VideoTrack, VideoLang];
  return { slot: key, value: (videos[key] as string).trim(), track, lang, note };
}

/** True when the lesson has a software-neutral video (no track switcher needed). */
export function isNeutralLesson(videos: LessonVideos): boolean {
  return has(videos, "neutral_en") || has(videos, "neutral_ar");
}

/** Tracks that have at least one recorded video. */
export function recordedTracks(videos: LessonVideos): CcTrackSoftware[] {
  return (["inventor", "fusion", "solidworks"] as const).filter((t) => has(videos, `${t}_en`) || has(videos, `${t}_ar`));
}

/** A track note value from cc_lessons.track_notes for the student's track. */
export type TrackNote = { kind: "inventor_only" } | { kind: "equivalent"; en: string; ar: string } | null;

export function trackNoteFor(trackNotes: unknown, track: CcTrackSoftware | null | undefined): TrackNote {
  if (!track || track === "inventor") return null;
  if (!trackNotes || typeof trackNotes !== "object" || Array.isArray(trackNotes)) return null;
  const v = (trackNotes as Record<string, unknown>)[track];
  if (v === "inventor_only") return { kind: "inventor_only" };
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (typeof o.en === "string" && typeof o.ar === "string" && o.en.trim() && o.ar.trim()) return { kind: "equivalent", en: o.en, ar: o.ar };
  }
  return null;
}
