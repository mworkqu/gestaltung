import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { fetchImage, isRasterContentType, looksLikeRaster, storeImage } from "@/lib/store/store-image";

// WEB-05 / API-08: supplier image import accepts raster images only, from
// allowed hosts on every hop, under a byte cap.

const HOSTS = /(^|\.)(digikey\.com|mouser\.com)$/i;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
let jpeg: Buffer;

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#c00" } }).jpeg().toBuffer();
});

function fakeFetch(map: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request) => {
    const make = map[String(url)];
    if (!make) throw new Error(`unexpected fetch ${String(url)}`);
    return make();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("fetchImage", () => {
  it("returns the bytes of a JPEG from an allowed host", async () => {
    const f = fakeFetch({
      "https://media.digikey.com/a.jpg": () => new Response(new Uint8Array(jpeg), { headers: { "content-type": "image/jpeg" } }),
    });
    const buf = await fetchImage("https://media.digikey.com/a.jpg", HOSTS, f);
    expect(buf).not.toBeNull();
    expect(Buffer.compare(buf!, jpeg)).toBe(0);
  });

  it("refuses SVG by content type", async () => {
    const f = fakeFetch({
      "https://media.digikey.com/a.svg": () => new Response(SVG, { headers: { "content-type": "image/svg+xml" } }),
    });
    expect(await fetchImage("https://media.digikey.com/a.svg", HOSTS, f)).toBeNull();
  });

  it("refuses SVG bytes served under a raster content type", async () => {
    const f = fakeFetch({
      "https://media.digikey.com/a.jpg": () => new Response(SVG, { headers: { "content-type": "image/jpeg" } }),
    });
    expect(await fetchImage("https://media.digikey.com/a.jpg", HOSTS, f)).toBeNull();
  });

  it("does not follow a redirect to a host outside the list", async () => {
    const f = fakeFetch({
      "https://media.digikey.com/r": () => new Response(null, { status: 302, headers: { location: "https://evil.example/a.jpg" } }),
    });
    expect(await fetchImage("https://media.digikey.com/r", HOSTS, f)).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("refuses a 20 MB body", async () => {
    const big = new Uint8Array(20 * 1024 * 1024);
    big.set(jpeg.subarray(0, 12));
    const f = fakeFetch({
      "https://media.digikey.com/big.jpg": () => new Response(big, { headers: { "content-type": "image/jpeg" } }),
    });
    expect(await fetchImage("https://media.digikey.com/big.jpg", HOSTS, f)).toBeNull();
  });

  it("refuses a first URL that is not https or not allowed", async () => {
    const f = fakeFetch({});
    expect(await fetchImage("http://media.digikey.com/a.jpg", HOSTS, f)).toBeNull();
    expect(await fetchImage("https://example.com/a.jpg", HOSTS, f)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("raster checks", () => {
  it("accepts only jpeg/png/webp/gif/avif content types", () => {
    for (const t of ["image/jpeg", "image/png; charset=binary", "IMAGE/WEBP", "image/gif", "image/avif"]) {
      expect(isRasterContentType(t)).toBe(true);
    }
    for (const t of ["image/svg+xml", "image/tiff", "text/html", "", null]) expect(isRasterContentType(t)).toBe(false);
  });

  it("recognises raster magic bytes and not SVG", () => {
    expect(looksLikeRaster(jpeg)).toBe(true);
    expect(looksLikeRaster(Buffer.from(SVG))).toBe(false);
  });

  it("storeImage refuses SVG before sharp processes it", async () => {
    await expect(storeImage({} as SupabaseClient, Buffer.from(SVG), "x")).rejects.toThrow("unsupported_format");
  });

  it("storeImage still processes JPEG and AVIF into two WebP uploads", async () => {
    const uploads: string[] = [];
    const db = {
      storage: {
        from: () => ({
          upload: async (path: string) => {
            uploads.push(path);
            return { error: null };
          },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
        }),
      },
    } as unknown as SupabaseClient;
    const avif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#0c0" } }).avif().toBuffer();
    for (const buf of [jpeg, avif]) {
      const img = await storeImage(db, buf, "t/1");
      expect(img.web).toBe("https://cdn.test/t/1-web.webp");
    }
    expect(uploads).toHaveLength(4);
  });
});
