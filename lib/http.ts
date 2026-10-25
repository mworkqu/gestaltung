// Route-handler response and body helpers (REFACTOR_PLAN §1, conventions 1-3).
// Error bodies are always `{ error: "<code>" }` with the HTTP status carrying the
// meaning. Pure Web-standard Request/Response, no Next imports, so it is
// unit-testable without a server.

import type { ZodType } from "zod";

/** 200 JSON by default; pass `{ status, headers }` for anything else. */
export function jsonOk(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

/** `{ error: code, ...extra }` with the given status, e.g. `jsonError("sign_in", 401)`. */
export function jsonError(code: string, status: number, extra?: Record<string, unknown> & { error?: never }): Response {
  return Response.json({ error: code, ...extra }, { status });
}

/** A bare status with no body (the `new Response(null, { status })` calls). */
export function emptyStatus(status: number): Response {
  return new Response(null, { status });
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/** 64 KiB: generous for every JSON route body in the app; routes with larger payloads pass their own cap. */
export const DEFAULT_MAX_JSON_BYTES = 65_536;

function isJsonContentType(header: string | null): boolean {
  const type = (header ?? "").split(";")[0]!.trim().toLowerCase();
  return type === "application/json";
}

/** Read the body as text, giving up once more than `maxBytes` have arrived. Null when over the cap. */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/**
 * Parse and validate a JSON request body.
 *   - 415 `unsupported_media_type`: Content-Type is not application/json
 *   - 413 `too_large`: Content-Length, or the bytes actually read, exceed `maxBytes`
 *   - 400 `bad_request`: empty or invalid JSON, or the zod schema rejects it
 *     (the code existing routes already answer with; issues are not echoed back)
 * Note: `fetch(url, { body: JSON.stringify(x) })` without a Content-Type header
 * sends text/plain and gets 415, so callers must set `Content-Type: application/json`.
 */
export async function parseJsonBody<T>(
  request: Request,
  schema: ZodType<T>,
  { maxBytes = DEFAULT_MAX_JSON_BYTES }: { maxBytes?: number } = {}
): Promise<ParsedBody<T>> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, response: jsonError("unsupported_media_type", 415) };
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return { ok: false, response: jsonError("too_large", 413) };
  }

  let text: string | null;
  try {
    text = await readCapped(request, maxBytes);
  } catch {
    return { ok: false, response: jsonError("bad_request", 400) };
  }
  if (text === null) return { ok: false, response: jsonError("too_large", 413) };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: jsonError("bad_request", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: jsonError("bad_request", 400) };
  return { ok: true, data: parsed.data };
}
