import { CAD_BUCKET, QUOTE_BUCKET } from "@/lib/design/constants";

// Storage paths /api/design-quote is willing to sign (API-04). The route uses
// the service role to mint a 7-day signed URL for whatever path the visitor
// posts, so the path must be exactly what our uploader writes
// (components/design/quote-request.tsx) and nothing else:
//
//   quote-uploads : <uuid>/<file name>                       (anyone, anonymous upload)
//   cad-files     : <user id>/<project uuid>/<uuid>-<file name>   (the project owner)
//
// <file name> is the uploader's sanitize(): letters, digits, "." "_" "-".
// Pure on purpose (no Next / Supabase imports): unit-tested.

const MAX_PATH = 400;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const NAME = "[A-Za-z0-9._-]{1,200}";

const QUOTE_SHAPE = new RegExp(`^(${UUID})/(${NAME})$`, "i");
const CAD_SHAPE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})-(${NAME})$`, "i");

/**
 * True when `path` in `bucket` is a path our uploader writes and the caller
 * may attach to a quote. `userId` is the verified Supabase user id of the
 * caller, or null without a session: cad-files needs a session and the first
 * segment must be that user's id.
 */
export function isAllowedQuoteStoragePath(bucket: string, path: unknown, userId: string | null): boolean {
  if (typeof path !== "string" || !path || path.length > MAX_PATH) return false;
  // Defence in depth ahead of the shape check: no traversal, encoding tricks,
  // backslashes, absolute paths or control characters, in any bucket.
  if (path.startsWith("/") || path.includes("\\") || path.includes("%")) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) return false;

  if (bucket === QUOTE_BUCKET) return QUOTE_SHAPE.test(path);

  if (bucket === CAD_BUCKET) {
    if (!userId) return false;
    const m = CAD_SHAPE.exec(path);
    return !!m && m[1]!.toLowerCase() === userId.toLowerCase();
  }
  return false;
}
