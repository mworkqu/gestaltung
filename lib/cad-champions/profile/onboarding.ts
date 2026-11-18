// Onboarding progress is stored in cc_profiles.onboarding_step (smallint, check 0..10).
// The brief asked for -1 on "Skip for now", but the column check is 0..10, so a
// value that fits the constraint is used instead. Keep every reader on this constant.

export const ONBOARDING_LAST_SCREEN = 3; // four screens: 0..3
export const ONBOARDING_SKIPPED_STEP = 9;

export function isOnboardingSkipped(step: number | null | undefined): boolean {
  return step === ONBOARDING_SKIPPED_STEP;
}

/** Screen to open on (0..3). A skipped or unknown step starts at the beginning. */
export function onboardingStartScreen(step: number | null | undefined): number {
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > ONBOARDING_LAST_SCREEN) return 0;
  return step;
}
