// Server-side mirror of the UploadBox checks — SERVER ONLY (service role).
// The browser can be bypassed, so anything graded or stored as a submission
// is re-checked here from the stored object itself: size and first bytes.
// Callers must check auth and that `path` belongs to the user first.

import { createServiceClient } from "@/lib/supabase/service";

import { DEFAULT_MAX_BYTES, HEADER_BYTES, validateFileMeta, validateHeader, type UploadAccept, type UploadValidation } from "./validate";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/upload/server.ts is server-only");

/** Buckets students upload into from the browser (their own folder only, per 0078 policies). */
export const CC_STUDENT_UPLOAD_BUCKETS = ["cc-submissions", "cc-payment-proofs"] as const;
export type CcStudentUploadBucket = (typeof CC_STUDENT_UPLOAD_BUCKETS)[number];

export function isStudentUploadBucket(value: unknown): value is CcStudentUploadBucket {
  return typeof value === "string" && (CC_STUDENT_UPLOAD_BUCKETS as readonly string[]).includes(value);
}

export type ObjectHead =
  | { ok: true; size: number; head: Uint8Array }
  | { ok: false; reason: "missing" | "unavailable" | "error" };

/**
 * Size and first `bytes` of a stored object, read with a Range request on a
 * 60-second signed URL (never downloads the whole file).
 */
export async function readObjectHead(bucket: string, path: string, bytes: number = HEADER_BYTES): Promise<ObjectHead> {
  const service = createServiceClient();
  if (!service) {
    console.warn("[cc-upload] SUPABASE_SERVICE_ROLE_KEY missing; cannot read", bucket);
    return { ok: false, reason: "unavailable" };
  }
  try {
    const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 60);
    if (error || !data?.signedUrl) {
      return { ok: false, reason: /not.?found|404/i.test(error?.message ?? "") ? "missing" : "error" };
    }
    const res = await fetch(data.signedUrl, {
      headers: { Range: `bytes=0-${bytes - 1}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 416) return { ok: true, size: 0, head: new Uint8Array() };
    if (res.status === 404 || res.status === 400) return { ok: false, reason: "missing" };
    if (!res.ok) {
      console.error("[cc-upload] head read failed:", res.status);
      return { ok: false, reason: "error" };
    }
    // A 200 (Range ignored) would be the whole object: read only the first chunk.
    const buf = await readFirstBytes(res, bytes);
    const range = res.headers.get("content-range"); // "bytes 0-63/12345"
    const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length") ?? buf.length);
    const size = Number.isFinite(total) ? total : buf.length;
    return { ok: true, size, head: buf.subarray(0, bytes) };
  } catch (e) {
    console.error("[cc-upload] head read failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** First `limit` bytes of a response body; cancels the rest of the stream. */
async function readFirstBytes(res: Response, limit: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).subarray(0, limit);
  const reader = res.body.getReader();
  const out = new Uint8Array(limit);
  let filled = 0;
  try {
    while (filled < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.length, limit - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.subarray(0, filled);
}

export type VerifyResult =
  | { ok: true; /** Real stored size in bytes (store this, never the client's number: SR-L10). */ size: number }
  | Extract<UploadValidation, { ok: false }>
  | { ok: false; code: "missing" | "unavailable" };

/** Re-runs the UploadBox checks (extension, size, empty, STEP header) on a stored object. */
export async function verifyUploadedObject(
  bucket: string,
  path: string,
  accept: UploadAccept,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<VerifyResult> {
  const head = await readObjectHead(bucket, path);
  if (!head.ok) return { ok: false, code: head.reason === "missing" ? "missing" : "unavailable" };
  const meta = validateFileMeta({ name: path, size: head.size }, accept, maxBytes);
  if (!meta.ok) return meta;
  const header = validateHeader(head.head, accept, path);
  return header.ok ? { ok: true, size: head.size } : header;
}
