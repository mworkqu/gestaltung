// Lists a ZIP stored in Supabase Storage through ranged downloads — SERVER ONLY
// (service role). Reads the object size, then only the end record and the
// central directory (zip-manifest.ts). Nothing is extracted or executed.
// Callers must check auth and that `path` belongs to the user first.

import { createServiceClient } from "@/lib/supabase/service";

import { PACKAGE_MAX_ENTRIES } from "./package-check";
import { readObjectHead } from "./server";
import { readZipEntries, type ZipListing } from "./zip-manifest";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/upload/zip-remote.ts is server-only");

export type RemoteZipListing = ZipListing | { ok: false; reason: "missing" | "unavailable" };

export async function readStoredZip(bucket: string, path: string): Promise<RemoteZipListing> {
  const service = createServiceClient();
  if (!service) return { ok: false, reason: "unavailable" };
  const head = await readObjectHead(bucket, path, 4);
  if (!head.ok) return { ok: false, reason: head.reason === "missing" ? "missing" : "unavailable" };

  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data?.signedUrl) return { ok: false, reason: "unavailable" };
  const url = data.signedUrl;

  return readZipEntries(
    head.size,
    async (start, end) => {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status !== 206 && res.status !== 200) throw new Error(`range read failed: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      // A server that ignores Range sends the whole object (200): cut the slice out.
      if (res.status === 200 && buf.length === head.size) return buf.subarray(start, end + 1);
      return buf;
    },
    { maxEntries: PACKAGE_MAX_ENTRIES }
  );
}
