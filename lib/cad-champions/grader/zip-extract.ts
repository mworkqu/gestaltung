// Reads ONE entry of a ZIP through a ranged reader (local header + data) and
// inflates it. Server only (node:zlib). Used to hand the STEP files of a
// module_package ZIP to the grader; nothing is written to disk or executed.

import { inflateRawSync } from "node:zlib";

import type { ZipEntryInfo } from "../upload/package-check";
import type { RangeReader } from "../upload/zip-manifest";

const SIG_LOCAL = 0x04034b50;

export type EntryData = { ok: true; bytes: Uint8Array } | { ok: false; reason: "unsupported" | "too_large" | "corrupt" };

export async function readZipEntryData(entry: ZipEntryInfo, read: RangeReader, maxBytes: number): Promise<EntryData> {
  const offset = entry.localHeaderOffset;
  if (offset == null || entry.encrypted || (entry.method !== 0 && entry.method !== 8)) return { ok: false, reason: "unsupported" };
  if (entry.uncompressedSize > maxBytes || entry.compressedSize > maxBytes * 2) return { ok: false, reason: "too_large" };
  try {
    const head = await read(offset, offset + 29);
    const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (head.length < 30 || v.getUint32(0, true) !== SIG_LOCAL) return { ok: false, reason: "corrupt" };
    const start = offset + 30 + v.getUint16(26, true) + v.getUint16(28, true);
    const raw = entry.compressedSize > 0 ? await read(start, start + entry.compressedSize - 1) : new Uint8Array();
    if (raw.length !== entry.compressedSize) return { ok: false, reason: "corrupt" };
    const bytes = entry.method === 0 ? raw : new Uint8Array(inflateRawSync(raw, { maxOutputLength: maxBytes + 1 }));
    if (bytes.length > maxBytes) return { ok: false, reason: "too_large" };
    if (bytes.length !== entry.uncompressedSize) return { ok: false, reason: "corrupt" };
    return { ok: true, bytes };
  } catch (e) {
    const code = (e as { code?: string })?.code;
    return { ok: false, reason: code === "ERR_BUFFER_TOO_LARGE" ? "too_large" : "corrupt" };
  }
}
