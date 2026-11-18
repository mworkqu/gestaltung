"use server";

import { ONBOARDING_LAST_SCREEN, ONBOARDING_SKIPPED_STEP } from "@/lib/cad-champions/profile/onboarding";
import { isCcTrack } from "@/lib/cad-champions/profile/track";
import { createClient } from "@/lib/supabase/server";

// Onboarding writes. Every action re-checks the session on the server and then
// writes through the user's own RLS client (a student may update their own
// cc_profiles row: track_software and the onboarding fields).

export type OnboardingResult = { ok: true } | { ok: false; error: "session" | "invalid" | "save" };

async function updateOwnProfile(values: Record<string, unknown>): Promise<OnboardingResult> {
  const supabase = await createClient();
  const { data, error: authError } = await supabase.auth.getUser();
  if (authError || !data.user) return { ok: false, error: "session" };

  const { error } = await supabase.from("cc_profiles").update(values).eq("id", data.user.id);
  if (error) {
    console.error("[cc onboarding] profile update failed", error.message);
    return { ok: false, error: "save" };
  }
  return { ok: true };
}

/** Remember which screen the student reached, so they can resume. */
export async function saveOnboardingStep(step: number): Promise<OnboardingResult> {
  if (!Number.isInteger(step) || step < 0 || step > ONBOARDING_LAST_SCREEN) return { ok: false, error: "invalid" };
  return updateOwnProfile({ onboarding_step: step });
}

/** "Skip for now": onboarding_completed_at stays null, the dashboard shows a "Finish onboarding" card. */
export async function skipOnboarding(): Promise<OnboardingResult> {
  return updateOwnProfile({ onboarding_step: ONBOARDING_SKIPPED_STEP });
}

/** Last screen: save the training software and mark onboarding done. */
export async function completeOnboarding(track: string): Promise<OnboardingResult> {
  if (!isCcTrack(track)) return { ok: false, error: "invalid" };
  return updateOwnProfile({
    track_software: track,
    onboarding_step: ONBOARDING_LAST_SCREEN,
    onboarding_completed_at: new Date().toISOString(),
  });
}
