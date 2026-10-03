// Picks part of the next-intl message tree for a NextIntlClientProvider.
// Pure, so it is unit-tested (pick-messages.test.ts) and shared by the scopes.
//
// An entry is either a whole namespace ("Parts") or one key inside it
// ("Parts.cartAria", any depth). Unknown entries are ignored, so a missing
// translation shows up as next-intl's usual missing-message fallback in the
// component, never as a crash here.

export type Messages = Record<string, unknown>;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A new tree holding only `entries` of `messages` (shared leaves, no deep clone). */
export function pickMessages(messages: Messages, entries: readonly string[]): Messages {
  const out: Messages = {};
  for (const entry of entries) {
    const path = entry.split(".");
    let src: unknown = messages;
    for (const key of path) src = isObject(src) ? src[key] : undefined;
    if (src === undefined) continue;
    let dst = out;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i];
      if (!isObject(dst[key])) dst[key] = {};
      dst = dst[key] as Messages;
    }
    const last = path[path.length - 1];
    // A whole namespace picked after some of its keys wins (and vice versa keeps the namespace).
    if (isObject(dst[last]) && isObject(src)) dst[last] = { ...(dst[last] as Messages), ...src };
    else dst[last] = src;
  }
  return out;
}
