// Scoring configuration (Prompt 7 Step A + COMPETITION_ALIGNMENT section D).
// The ONE place for level thresholds, bands and the official skill weights.
// Pure data, safe on server and client.

import type { CcBand, CcSkillAreaId } from "../db/types";

export type CcLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** Level per skill area from its percent: lowest percent that reaches the level. */
export const LEVEL_THRESHOLDS: readonly { level: CcLevel; min: number }[] = [
  { level: 1, min: 0 },
  { level: 2, min: 20 },
  { level: 3, min: 40 },
  { level: 4, min: 60 },
  { level: 5, min: 75 },
  { level: 6, min: 90 },
];

/** Band from the overall percent. */
export const BAND_THRESHOLDS: readonly { band: CcBand; min: number }[] = [
  { band: "beginner", min: 0 },
  { band: "developing", min: 40 },
  { band: "competitive", min: 65 },
  { band: "competition_ready", min: 85 },
];

/**
 * Official skill weights (percent). cc_skill_areas.weight_percent is the
 * source of truth; this is the fallback when the table cannot be read.
 */
export const OFFICIAL_WEIGHTS: Readonly<Record<CcSkillAreaId, number>> = {
  1: 10,
  2: 5,
  3: 30,
  4: 10,
  5: 15,
  6: 30,
};

export const SKILL_AREA_IDS: readonly CcSkillAreaId[] = [1, 2, 3, 4, 5, 6];

/** Judgement aspects are marked 0-3 (points = max x score / 3). */
export const JUDGEMENT_MAX = 3;

/** Where an unassessed area is covered instead (message key under CC.results.skillMap.coverage). */
export const UNASSESSED_COVERAGE: Readonly<Record<CcSkillAreaId, string>> = {
  1: "organisation",
  2: "software",
  3: "modelling",
  4: "rendering",
  5: "reverse",
  6: "drawing",
};
