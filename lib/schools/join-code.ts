// The class join code and the team name students type on /join.
//
// The code is 6 characters from an alphabet with no vowels and no look-alikes
// (no 0/O, no 1/I), so a code read off a printed sheet cannot be mistyped into
// another class, and a code can never spell a word. Mirrors the alphabet and
// the check constraint in migration 0096 — keep them identical.
//
// Pure: tested in lib/schools/join-code.test.ts.

export const JOIN_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;
export const TEAM_NAME_MAX = 40;

const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$/;

/**
 * What a typed code becomes before it is sent: upper case, spaces and dashes
 * dropped, O/o → 0 is NOT guessed (0 is not in the alphabet, so it is simply
 * not a code character and the server says the code is wrong).
 */
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[\s-]+/g, "").toUpperCase().slice(0, JOIN_CODE_LENGTH);
}

/** True when a normalised code could be a real one (the server still decides). */
export function isJoinCodeShape(raw: string): boolean {
  return CODE_RE.test(normalizeJoinCode(raw));
}

/** What a typed team name becomes: inner spaces collapsed, trimmed, capped. */
export function normalizeTeamName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, TEAM_NAME_MAX);
}

export function isTeamNameValid(raw: string): boolean {
  const name = normalizeTeamName(raw);
  return name.length >= 1 && name.length <= TEAM_NAME_MAX;
}

/** The link printed on the class sheet. Arabic first — the sheet is AR-first. */
export function joinUrl(origin: string, code: string, locale: "ar" | "en" = "ar"): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/${locale}/join?code=${encodeURIComponent(normalizeJoinCode(code))}`;
}
