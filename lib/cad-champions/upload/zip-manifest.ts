// ZIP central-directory reader (module_package uploads). Lists the entries of
// a ZIP WITHOUT downloading or extracting it: it reads the end of the file
// (end-of-central-directory record, ZIP64 when needed) and then the central
// directory, through a caller-supplied ranged reader. Nothing is
// decompressed and no file content is read. Pure: the server passes a reader
// built on a signed URL + HTTP Range (zip-remote.ts); tests pass bytes in memory.

import type { ZipEntryInfo } from "./package-check";

/** Reads bytes [start, endInclusive] of the object. */
export type RangeReader = (start: number, endInclusive: number) => Promise<Uint8Array>;

export type ZipListing =
  | { ok: true; entries: ZipEntryInfo[]; totalEntries: number }
  | { ok: false; reason: "not_zip" | "too_many_files" | "unreadable"; totalEntries?: number };

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;
const U32_MAX = 0xffffffff;

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function u64(v: DataView, at: number): number {
  return v.getUint32(at, true) + v.getUint32(at + 4, true) * 0x1_0000_0000;
}

/** Position of the end-of-central-directory record inside `tail`, or -1. */
export function findEocd(tail: Uint8Array): number {
  const v = view(tail);
  for (let i = tail.length - EOCD_MIN; i >= 0 && i >= tail.length - EOCD_MIN - MAX_COMMENT; i--) {
    if (v.getUint32(i, true) === SIG_EOCD) {
      const commentLen = v.getUint16(i + 20, true);
      if (i + EOCD_MIN + commentLen <= tail.length) return i;
    }
  }
  return -1;
}

const decoder = new TextDecoder("utf-8");

/** Parses `count` central-directory headers from `cd`. Stops early on a bad signature. */
export function parseCentralDirectory(cd: Uint8Array, count: number): ZipEntryInfo[] {
  const v = view(cd);
  const out: ZipEntryInfo[] = [];
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== SIG_CENTRAL) break;
    let compressedSize = v.getUint32(p + 20, true);
    let uncompressedSize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const externalAttrs = v.getUint32(p + 38, true);
    if (p + 46 + nameLen + extraLen + commentLen > cd.length) break;
    const name = decoder.decode(cd.subarray(p + 46, p + 46 + nameLen));

    // ZIP64 extended information (header id 0x0001): sizes that did not fit in 32 bits.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = v.getUint16(e, true);
      const len = v.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === U32_MAX && q + 8 <= e + 4 + len) {
          uncompressedSize = u64(v, q);
          q += 8;
        }
        if (compressedSize === U32_MAX && q + 8 <= e + 4 + len) compressedSize = u64(v, q);
        break;
      }
      e += 4 + len;
    }

    // MS-DOS directory attribute (0x10) or a trailing slash marks a folder.
    const isDirectory = /[\\/]$/.test(name) || (externalAttrs & 0x10) === 0x10;
    out.push({ name, compressedSize, uncompressedSize, isDirectory });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * Lists a ZIP of `size` bytes. `maxEntries` stops before reading a huge
 * central directory (the count comes from the end record). Never throws.
 */
export async function readZipEntries(
  size: number,
  read: RangeReader,
  opts: { maxEntries: number; maxCentralDirectoryBytes?: number }
): Promise<ZipListing> {
  const maxCd = opts.maxCentralDirectoryBytes ?? 8 * 1024 * 1024;
  if (!Number.isFinite(size) || size < EOCD_MIN) return { ok: false, reason: "not_zip" };
  try {
    const tailLen = Math.min(size, EOCD_MIN + MAX_COMMENT + 20);
    const tailStart = size - tailLen;
    const tail = await read(tailStart, size - 1);
    const at = findEocd(tail);
    if (at < 0) return { ok: false, reason: "not_zip" };
    const tv = view(tail);
    let total = tv.getUint16(at + 10, true);
    let cdSize = tv.getUint32(at + 12, true);
    let cdOffset = tv.getUint32(at + 16, true);

    if (total === 0xffff || cdSize === U32_MAX || cdOffset === U32_MAX) {
      const loc = at - 20;
      if (loc < 0 || tv.getUint32(loc, true) !== SIG_ZIP64_LOCATOR) return { ok: false, reason: "unreadable" };
      const z64At = u64(tv, loc + 8);
      if (!(z64At >= 0 && z64At + 56 <= size)) return { ok: false, reason: "unreadable" };
      const rec = await read(z64At, z64At + 55);
      const rv = view(rec);
      if (rec.length < 56 || rv.getUint32(0, true) !== SIG_ZIP64_EOCD) return { ok: false, reason: "unreadable" };
      total = u64(rv, 32);
      cdSize = u64(rv, 40);
      cdOffset = u64(rv, 48);
    }

    if (total > opts.maxEntries) return { ok: false, reason: "too_many_files", totalEntries: total };
    if (total === 0) return { ok: true, entries: [], totalEntries: 0 };
    if (cdSize > maxCd) return { ok: false, reason: "too_many_files", totalEntries: total };
    if (cdOffset + cdSize > size) return { ok: false, reason: "unreadable" };

    const cd =
      cdOffset >= tailStart
        ? tail.subarray(cdOffset - tailStart, cdOffset - tailStart + cdSize)
        : await read(cdOffset, cdOffset + cdSize - 1);
    const entries = parseCentralDirectory(cd, total);
    if (entries.length !== total) return { ok: false, reason: "unreadable", totalEntries: total };
    return { ok: true, entries, totalEntries: total };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
