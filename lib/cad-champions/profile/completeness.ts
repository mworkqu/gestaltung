// Profile completeness card: percent of filled profile fields, plus which are missing.

export const PROFILE_COMPLETENESS_FIELDS = [
  "full_name",
  "full_name_ar",
  "phone",
  "date_of_birth",
  "institution",
  "study_level",
  "cad_software_used",
  "cad_experience",
  "has_windows_pc",
] as const;
export type ProfileCompletenessField = (typeof PROFILE_COMPLETENESS_FIELDS)[number];

export type ProfileCompleteness = {
  percent: number;
  missing: ProfileCompletenessField[];
};

function filled(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined;
}

export function profileCompleteness(
  profile: Partial<Record<ProfileCompletenessField, unknown>> | null | undefined,
): ProfileCompleteness {
  const missing = PROFILE_COMPLETENESS_FIELDS.filter((f) => !filled(profile?.[f]));
  const total = PROFILE_COMPLETENESS_FIELDS.length;
  return { percent: Math.round(((total - missing.length) / total) * 100), missing: [...missing] };
}
