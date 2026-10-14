// Training catalog constants (pure data, safe on server and client).
// Module slugs match the seed in supabase/migrations/0083_cc_training_seed.sql.

import type { CcSkillAreaId } from "../db/types";

export const TRAINING_COURSE_SLUG = "cad-champions";

export const MODULE_SLUGS = {
  orientation: "orientation",
  foundations: "foundations",
  m1: "m1-fabrication",
  m2: "m2-design-challenge",
  m3: "m3-assemblies-drawings",
  m4: "m4-reverse-engineering",
  mocks: "mock-competitions",
} as const;

/** Modules that issue a certificate when every level is completed. */
export const CERTIFICATE_MODULES: readonly string[] = [MODULE_SLUGS.foundations, MODULE_SLUGS.m1, MODULE_SLUGS.m2, MODULE_SLUGS.m3, MODULE_SLUGS.m4];

/** Free sample lessons for the "Recommended for you" row and the not-enrolled banner. */
export const FIRST_LESSON_SLUG = "how-this-training-works";

/**
 * Where to train each skill area (recommendTrainingPath keys -> modules).
 * Technical drawing is Foundations Level 6 first, then the M3 track.
 */
export const MODULE_FOR_SKILL_AREA: Readonly<Record<CcSkillAreaId, { module: string; level?: number }>> = {
  1: { module: MODULE_SLUGS.orientation },
  2: { module: MODULE_SLUGS.foundations, level: 1 },
  3: { module: MODULE_SLUGS.foundations },
  4: { module: MODULE_SLUGS.m2, level: 3 },
  5: { module: MODULE_SLUGS.m4 },
  6: { module: MODULE_SLUGS.foundations, level: 6 },
};

/**
 * Allowed measuring instruments (COMPETITION_ALIGNMENT section B) with the
 * short M4 lesson for each. Names, what it measures and ranges are message
 * keys under CC.training.instruments.items.<key>.
 */
export const INSTRUMENTS = [
  { key: "digitalCaliper", lessonSlug: "m4-digital-caliper" },
  { key: "offsetCaliper", lessonSlug: "m4-offset-centerline-caliper" },
  { key: "protractor", lessonSlug: "m4-protractor" },
  { key: "radiusGauges", lessonSlug: "m4-radius-gauges" },
  { key: "threadGauges", lessonSlug: "m4-thread-pitch-gauges" },
  { key: "roughness", lessonSlug: "m4-roughness-comparator" },
  { key: "steelRuler", lessonSlug: "m4-steel-ruler" },
  { key: "depthGauge", lessonSlug: "m4-depth-gauge" },
] as const;

export type InstrumentKey = (typeof INSTRUMENTS)[number]["key"];

/** In-person venue (owner decision: Rafal Tower, Lusail). */
export const IN_PERSON_MAP_URL = "https://www.google.com/maps/search/?api=1&query=Rafal+Tower+Lusail+Qatar";

/** Upload folder for exercise files (cc-submissions RLS: first folder = the user's id). */
export function exercisePrefix(userId: string, exerciseId: string): string {
  return `${userId}/exercises/${exerciseId}/`;
}

/** Upload folder for lesson question images. */
export function questionPrefix(userId: string): string {
  return `${userId}/questions/`;
}

export const QUESTION_MAX = 2000;
export const QUESTION_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
