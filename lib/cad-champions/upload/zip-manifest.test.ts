import { describe, expect, it } from "vitest";

import { zipStore } from "@/lib/studio/zip";

import { templateEntries } from "./package-check";
import { findEocd, readZipEntries, type RangeReader } from "./zip-manifest";

function reader(bytes: Uint8Array, log: [number, number][] = []): RangeReader {
  return async (start, end) => {
    log.push([start, end]);
    return bytes.slice(start, end + 1);
  };
}

/** Rewrites a plain zip into its ZIP64 form (zip64 end record + locator, 0xFFFF markers). */
function toZip64(zip: Uint8Array): Uint8Array {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = findEocd(zip);
  const total = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  const out = new Uint8Array(eocd + 56 + 20 + 22);
  out.set(zip.subarray(0, eocd));
  const o = new DataView(out.buffer);
  let p = eocd;
  o.setUint32(p, 0x06064b50, true);
  o.setUint32(p + 4, 44, true);
  o.setUint16(p + 12, 45, true);
  o.setUint16(p + 14, 45, true);
  o.setUint32(p + 24, total, true);
  o.setUint32(p + 32, total, true);
  o.setUint32(p + 40, cdSize, true);
  o.setUint32(p + 48, cdOffset, true);
  const z64At = p;
  p += 56;
  o.setUint32(p, 0x07064b50, true);
  o.setUint32(p + 8, z64At, true);
  o.setUint32(p + 16, 1, true);
  p += 20;
  o.setUint32(p, 0x06054b50, true);
  o.setUint16(p + 8, 0xffff, true);
  o.setUint16(p + 10, 0xffff, true);
  o.setUint32(p + 12, 0xffffffff, true);
  o.setUint32(p + 16, 0xffffffff, true);
  return out;
}

describe("readZipEntries", () => {
  it("lists files and folders from the central directory", async () => {
    const zip = zipStore([
      { name: "A07/DAY 01/Results/PDF files/", data: "" },
      { name: "A07/DAY 01/Results/PDF files/Drawing_02.pdf", data: "%PDF-1.7 hello" },
      { name: "A07/DAY 01/Results/Parts and Assemblies/Part_03.step", data: "ISO-10303-21;" },
    ]);
    const res = await readZipEntries(zip.length, reader(zip), { maxEntries: 500 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.totalEntries).toBe(3);
    expect(res.entries.every((e) => typeof e.localHeaderOffset === "number" && e.method === 0 && e.encrypted === false)).toBe(true);
    expect(res.entries).toMatchObject([
      { name: "A07/DAY 01/Results/PDF files/", compressedSize: 0, uncompressedSize: 0, isDirectory: true },
      { name: "A07/DAY 01/Results/PDF files/Drawing_02.pdf", compressedSize: 14, uncompressedSize: 14, isDirectory: false },
      { name: "A07/DAY 01/Results/Parts and Assemblies/Part_03.step", compressedSize: 13, uncompressedSize: 13, isDirectory: false },
    ]);
  });

  it("reads only the end of a large file (ranged reads)", async () => {
    const big = new Uint8Array(200_000).fill(65);
    const zip = zipStore([{ name: "Results/Animations/a.avi", data: big }, { name: "Results/PDF files/a.pdf", data: "x" }]);
    const log: [number, number][] = [];
    const res = await readZipEntries(zip.length, reader(zip, log), { maxEntries: 500 });
    expect(res.ok && res.entries.length).toBe(2);
    const bytesRead = log.reduce((s, [a, b]) => s + (b - a + 1), 0);
    expect(bytesRead).toBeLessThan(70_000);
    expect(log.every(([a]) => a > 100_000)).toBe(true);
  });

  it("reads the template ZIP", async () => {
    const names = templateEntries();
    const zip = zipStore(names.map((name) => ({ name, data: "" })));
    const res = await readZipEntries(zip.length, reader(zip), { maxEntries: 500 });
    expect(res.ok && res.entries.map((e) => e.name)).toEqual(names);
    expect(res.ok && res.entries.every((e) => e.isDirectory)).toBe(true);
  });

  it("supports ZIP64 end records", async () => {
    const zip = toZip64(zipStore([{ name: "Results/STL files/a.stl", data: "solid a" }]));
    const res = await readZipEntries(zip.length, reader(zip), { maxEntries: 500 });
    expect(res.ok && res.entries[0].name).toBe("Results/STL files/a.stl");
  });

  it("stops before reading a directory with too many entries", async () => {
    const zip = zipStore(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: "x" })));
    const res = await readZipEntries(zip.length, reader(zip), { maxEntries: 10 });
    expect(res).toEqual({ ok: false, reason: "too_many_files", totalEntries: 12 });
  });

  it("rejects files that are not ZIPs", async () => {
    const notZip = new TextEncoder().encode("this is not a zip file at all, just some text that is long enough");
    expect(await readZipEntries(notZip.length, reader(notZip), { maxEntries: 500 })).toEqual({ ok: false, reason: "not_zip" });
    expect(await readZipEntries(5, reader(notZip), { maxEntries: 500 })).toEqual({ ok: false, reason: "not_zip" });
  });

  it("reports a failing reader as unreadable", async () => {
    const zip = zipStore([{ name: "a.txt", data: "x" }]);
    const res = await readZipEntries(zip.length, async () => {
      throw new Error("network");
    }, { maxEntries: 500 });
    expect(res).toEqual({ ok: false, reason: "unreadable" });
  });
});
