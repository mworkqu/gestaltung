import { describe, expect, it } from "vitest";

import { conceptImageEnabled, generateConceptImage, parseConceptSetting } from "../product/ai/concept";
import { chosenPreviewPath } from "./preview-url";
import { decodePng, guestDesignLimit, isPreviewPath, newDesignId, qatarDay, type LimitStore } from "./product";

const P = "11111111-1111-4111-8111-111111111111";

describe("product route helpers", () => {
  it("design ids match the page-safe schema", () => {
    for (let i = 0; i < 50; i++) expect(newDesignId()).toMatch(/^d_[a-z0-9]{10}$/);
  });

  it("decodePng accepts PNG base64 / data URLs only, within the size cap", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]);
    expect(decodePng(png.toString("base64"), 1000)?.length).toBe(48);
    expect(decodePng(`data:image/png;base64,${png.toString("base64")}`, 1000)).not.toBeNull();
    expect(decodePng(Buffer.from("GIF89a-not-a-png-at-all-really").toString("base64"), 1000)).toBeNull();
    expect(decodePng(png.toString("base64"), 10)).toBeNull();
    expect(decodePng("<script>", 1000)).toBeNull();
  });

  it("qatarDay rolls over at 21:00 UTC", () => {
    expect(qatarDay(Date.UTC(2026, 9, 11, 20, 59))).toBe("2026-10-11");
    expect(qatarDay(Date.UTC(2026, 9, 11, 21, 0))).toBe("2026-10-12");
  });

  it("guest limit: counted per session + hashed IP; a broken store lets the build through", async () => {
    const hits = new Map<string, number>();
    const store: LimitStore = {
      hits: async (keys) => keys.map((k) => hits.get(k) ?? 0),
      bump: async (keys) => void keys.forEach((k) => hits.set(k, (hits.get(k) ?? 0) + 1)),
    };
    const req = new Request("http://x", { headers: { "x-forwarded-for": "5.6.7.8" } });
    const res = [];
    for (let i = 0; i < 4; i++) res.push((await guestDesignLimit(req, "u1", store)).allowed);
    expect(res).toEqual([true, true, true, false]);
    expect([...hits.keys()].some((k) => k.includes("5.6.7.8"))).toBe(false);
    const broken: LimitStore = { hits: async () => Promise.reject(new Error("x")), bump: async () => undefined };
    expect((await guestDesignLimit(req, "u2", broken)).allowed).toBe(true);
    expect((await guestDesignLimit(req, "u3", null)).allowed).toBe(true);
  });

  it("only our preview paths are signed; the chosen design's picture is the one shown", () => {
    expect(isPreviewPath(`studio-previews/${P}/d_abcdef1234.png`)).toBe(true);
    expect(isPreviewPath(`u/${P}/x.png`)).toBe(false);
    expect(isPreviewPath(`studio-previews/${P}/../../etc.png`)).toBe(false);
    const product = {
      chosenId: "d_bbbbbbbbbb",
      designs: [
        { id: "d_aaaaaaaaaa", previewPath: `studio-previews/${P}/d_aaaaaaaaaa.png` },
        { id: "d_bbbbbbbbbb", previewPath: `studio-previews/${P}/d_bbbbbbbbbb.png` },
      ],
    };
    expect(chosenPreviewPath(product)).toBe(`studio-previews/${P}/d_bbbbbbbbbb.png`);
    expect(chosenPreviewPath({ ...product, chosenId: null })).toBeNull();
    expect(chosenPreviewPath(null)).toBeNull();
  });
});

describe("concept image (store_settings.studio_concept_image)", () => {
  it("is off unless explicitly true; the stub never generates", async () => {
    expect(parseConceptSetting(undefined)).toBe(false);
    expect(parseConceptSetting("true")).toBe(false);
    expect(parseConceptSetting(true)).toBe(true);
    expect(parseConceptSetting({ enabled: true })).toBe(true);
    const row = (value: unknown, error: unknown = null) =>
      ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: value === undefined ? null : { value }, error }) }) }) }) }) as never;
    expect(await conceptImageEnabled(row(undefined))).toBe(false);
    expect(await conceptImageEnabled(row(true, { message: "x" }))).toBe(false);
    expect(await conceptImageEnabled(row({ enabled: true }))).toBe(true);
    expect(await generateConceptImage({ enabled: false })).toEqual({ skipped: "off" });
    expect(await generateConceptImage({ enabled: true })).toEqual({ skipped: "no_free_image_model" });
  });
});
