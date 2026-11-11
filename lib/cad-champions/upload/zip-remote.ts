// Lists a ZIP stored in Supabase Storage through ranged downloads — SERVER ONLY
// (service role). Reads the object size, then only the end record and the
// central directory (zip-manifest.ts). Nothing is extracted or executed.
// Callers must check auth and that `path` belongs to the user first.

import { createServiceClient } from "@/lib/supabase/service";

import { PACKAGE_MAX_ENTRIES } from "./package-check";
import { readObjectHead } from "./server";
import { readZipEntries, type RangeReader, type ZipListing } from "./zip-manifest";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/upload/zip-remote.ts is server-only");

export type RemoteZipListing = ZipListing | { ok: false; reason: "missing" | "unavailable" };

export type StoredZip = { ok: true; size: number; read: RangeReader } | { ok: false; reason: "missing" | "unavailable" };

/** Size + a ranged reader over a signed URL (valid `ttlSeconds`). */
export async function openStoredZip(bucket: string, path: string, ttlSeconds = 300): Promise<StoredZip> {
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  const head = await readObjectHead(bucket, path, 4);
  if (!head.ok) return { ok: false, reason: head.reason === "missing" ? "missing" : "unavailable" };

  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  if (error || !data?.signedUrl) return { ok: false, reason: "unavailable" };
  const url = data.signedUrl;
  const size = head.size;

  const read: RangeReader = async (start, end) => {
    const res = await fetch(url, {
      headers: { Range: `bytes=${start}-${end}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 206 && res.status !== 200) throw new Error(`range read failed: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    // A server that ignores Range sends the whole object (200): cut the slice out.
    if (res.status === 200 && buf.length === size) return buf.subarray(start, end + 1);
    return buf;
  };
  return { ok: true, size, read };
}

export async function readStoredZip(bucket: string, path: string): Promise<RemoteZipListing> {
  const zip = await openStoredZip(bucket, path);
  if (!zip.ok) return zip;
  return readZipEntries(zip.size, zip.read, { maxEntries: PACKAGE_MAX_ENTRIES });
}
