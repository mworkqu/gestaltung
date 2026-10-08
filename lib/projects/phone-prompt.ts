// When to ask for a WhatsApp number (P1-11 / CC-1). Starting a project no
// longer asks for one; it is asked only where it is needed — when the parts
// list first appears, when a guest saves their project link, or on a quote —
// and never again once the profile has a phone.

/** localStorage key: "Not now" was pressed in this browser. */
export function phonePromptDismissKey(userId: string): string {
  return `gestaltung:phone-prompt-dismissed:${userId}`;
}

/**
 * True when the inline phone card should show. `profilePhone` undefined means
 * the profile is still loading (never show yet). Accounts are asked too (the
 * phone is how we reach either), but never once their profile has a phone.
 */
export function shouldShowPhonePrompt({
  profilePhone,
  dismissed,
}: {
  profilePhone: string | null | undefined;
  isAccount: boolean;
  dismissed: boolean;
}): boolean {
  if (profilePhone === undefined) return false;
  if (profilePhone && profilePhone.trim()) return false;
  return !dismissed;
}

/** The recovery email RPC only accepts projects under an hour old (0045). */
export const SAVE_LINK_WINDOW_MS = 60 * 60 * 1000;

/** Whether "Save my project link" can still work for a project created at `createdAt`. */
export function saveLinkAvailable(createdAt: string | null | undefined, now: number): boolean {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(t)) return false;
  return now - t < SAVE_LINK_WINDOW_MS;
}
