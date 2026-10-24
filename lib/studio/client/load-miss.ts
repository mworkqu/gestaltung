// F-025: a project the browser cannot read is not always "try again later".
// A guest's project belongs to an anonymous session whose token lives in this browser; after
// site data is cleared (or on another device) that session is new, the project is invisible
// and a retry can never work. Tell that case apart so the page can offer sign-in / start again.

export type MissError = "guest_gone" | "not_found";

/** @param user the current session's user, or null when there is none at all */
export function missingProjectError(user: { is_anonymous?: boolean } | null | undefined): MissError {
  if (!user) return "guest_gone";
  return user.is_anonymous === true ? "guest_gone" : "not_found";
}

/** Load errors where the guest token is gone (the project may exist under another session). */
export const isGuestTokenGone = (error: string): boolean => error === "guest_gone" || error === "sign_in";
