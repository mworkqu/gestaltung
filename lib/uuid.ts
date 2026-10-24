// The one UUID check. Strict 8-4-4-4-12 hex, case-insensitive, anchored, so it
// accepts any RFC 4122 shape (including Postgres gen_random_uuid() output) and
// rejects anything with extra characters. Pure, safe to import in the browser.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when `v` is a string in canonical UUID form. Narrows `unknown` to `string`. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
