import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { Sha256, sha256File } from "./hash";

const nodeHex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

function bytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n));
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

describe("Sha256", () => {
  it("matches the FIPS test vectors", () => {
    expect(new Sha256().update(new Uint8Array()).digestHex()).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    expect(new Sha256().update(new TextEncoder().encode("abc")).digestHex()).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("gives the same digest however the input is split", () => {
    for (const n of [55, 56, 63, 64, 65, 119, 1000, 100_003]) {
      const data = bytes(n);
      const h = new Sha256();
      for (let i = 0; i < n; i += 37) h.update(data.subarray(i, i + 37));
      expect(h.digestHex()).toBe(nodeHex(data));
    }
  });
});

describe("sha256File", () => {
  const data = bytes(300_000);
  const blob = new Blob([data]);

  it("WebCrypto path matches node:crypto", async () => {
    expect(await sha256File(blob)).toBe(nodeHex(data));
  });

  it("chunked path matches and reports progress", async () => {
    const seen: number[] = [];
    const hex = await sha256File(blob, { forceChunked: true, chunkSize: 70_000, onProgress: (f) => seen.push(f) });
    expect(hex).toBe(nodeHex(data));
    expect(seen.at(-1)).toBe(1);
    expect(seen.length).toBeGreaterThan(1);
  });
});
