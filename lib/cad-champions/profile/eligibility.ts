// "Competition age-eligible until <year>" (informational only).
// Rule used: the world competition is for competitors aged 22 or younger in the
// competition year, so the last eligible year is the birth year + 22.
// [TODO-MO: confirm the local Qatar selection rule] (docs/CONTENT_TODO.md)

export const COMPETITION_MAX_AGE = 22;

/** Last competition year the student can enter, or null when the date of birth is missing or invalid. */
export function ageEligibleUntilYear(dateOfBirth: string | Date | null | undefined): number | null {
  if (!dateOfBirth) return null;
  let year: number;
  if (dateOfBirth instanceof Date) {
    if (Number.isNaN(dateOfBirth.getTime())) return null;
    year = dateOfBirth.getUTCFullYear();
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth.trim());
    if (!m) return null;
    year = Number(m[1]);
  }
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  return year + COMPETITION_MAX_AGE;
}
