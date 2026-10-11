// P5-16: projects.studio.productPrivate is stripped from every doc read and
// merged back (never taken from the page) on every save; `product` is
// server-owned the same way. Plus the design-state transforms of the routes.

import { describe, expect, it } from "vitest";

import { emptyStudioDoc, parseStudioDoc, PRODUCT_DESIGNS_MAX, StudioDocSchema, type ProductDoc } from "../schema";
import { archetypeDefault } from "./archetypes";
import { GOLDEN_IDEAS, goldenParts } from "./__fixtures__/golden";
import { defaultDesign } from "./ai/design";
import { finalModel, mergeServerOwned, parseProductPrivate, serverOwnedOf, stripServerOnly, trimPrivate, PRIVATE_MAX_BYTES, type ProductPrivate } from "./private";
import { addDesigns, applyCheck, applyChoose, applyPreview, applyUnlock, EMPTY_PRODUCT, findDesign } from "./store";

const g = GOLDEN_IDEAS[0];
const parts = goldenParts(g);
const model = archetypeDefault("stake_device", g.spec, parts);
const product: ProductDoc = {
  designs: [{ id: "d_aaaaaaaaaa", archetype: "stake_device", why: { en: "e", ar: "ع" }, previewPath: null, status: "building" }],
  chosenId: null,
  unlockedId: null,
  specHash: "h1",
};
const priv: ProductPrivate = { designs: [{ id: "d_aaaaaaaaaa", model, source: "ai", score: 6 }] };
const stored = { ...emptyStudioDoc(g.spec), product, productPrivate: priv };

describe("strip on read", () => {
  it("parseStudioDoc drops productPrivate but keeps the page-safe product", () => {
    const doc = parseStudioDoc(JSON.parse(JSON.stringify(stored)))!;
    expect(doc).not.toBeNull();
    expect("productPrivate" in doc).toBe(false);
    expect(doc.product).toEqual(product);
    expect(JSON.stringify(doc)).not.toContain('"bodies"');
  });
  it("stripServerOnly removes the private key of a raw value", () => {
    expect(Object.keys(stripServerOnly(stored))).not.toContain("productPrivate");
  });
  it("the page-safe schema has no room for a model", () => {
    const forged = { ...emptyStudioDoc(g.spec), product: { ...product, designs: [{ ...product.designs[0], model }] } };
    const r = StudioDocSchema.safeParse(forged);
    expect(r.success && JSON.stringify(r.data)).not.toContain('"bodies"');
  });
});

describe("merge on save", () => {
  it("keeps the stored product + private data whatever the page sends", () => {
    const pageDoc = { ...emptyStudioDoc(g.spec), product: { ...product, unlockedId: "d_aaaaaaaaaa", chosenId: "d_aaaaaaaaaa" } };
    const pageWithPrivate = { ...pageDoc, productPrivate: { designs: [] } } as unknown as typeof pageDoc;
    const owned = serverOwnedOf(stored);
    const out = mergeServerOwned(pageWithPrivate, owned);
    expect((out.product as ProductDoc).unlockedId).toBeNull(); // can't unlock itself
    expect(out.productPrivate).toEqual(priv); // can't erase
  });
  it("a page save without product never erases the stored one; none stored → none written", () => {
    const out = mergeServerOwned(emptyStudioDoc(g.spec), serverOwnedOf(stored));
    expect(out.product).toEqual(product);
    const none = mergeServerOwned({ ...emptyStudioDoc(g.spec), product }, serverOwnedOf({}));
    expect("product" in none).toBe(false);
    expect("productPrivate" in none).toBe(false);
  });
  it("parseProductPrivate re-clamps models and drops junk", () => {
    const p = parseProductPrivate({ designs: [{ id: "d_x", model: { bodies: "x" } }, { nope: 1 }, "x"] })!;
    expect(p.designs).toHaveLength(1);
    expect(p.designs[0].model.bodies.length).toBeGreaterThanOrEqual(2);
    expect(parseProductPrivate(null)).toBeNull();
  });
  it("trimPrivate drops the oldest unkept designs over the cap", () => {
    const big = { designs: Array.from({ length: 80 }, (_, i) => ({ id: `d_${String(i).padStart(10, "0")}`, model, source: "default" as const, issues: Array(60).fill({ code: "x".repeat(40) }) })) };
    const t = trimPrivate(big, ["d_0000000000"]);
    expect(Buffer.byteLength(JSON.stringify(t))).toBeLessThanOrEqual(PRIVATE_MAX_BYTES);
    expect(t.designs[0].id).toBe("d_0000000000");
  });
});

describe("design state transforms", () => {
  const design = (id: string, a: Parameters<typeof defaultDesign>[0] = "lamp") => ({ ...defaultDesign(a, g.spec, parts), id });

  it("addDesigns appends, a new spec keeps only chosen/unlocked, and caps the list", () => {
    let s = addDesigns({ product: EMPTY_PRODUCT, priv: { designs: [] } }, [design("d_1111111111"), design("d_2222222222")], "h1");
    expect(s.product.designs.map((d) => d.status)).toEqual(["building", "building"]);
    expect(s.priv.designs).toHaveLength(2);
    s = applyChoose(s, "d_2222222222");
    s = addDesigns(s, [design("d_3333333333")], "h2");
    expect(s.product.designs.map((d) => d.id)).toEqual(["d_2222222222", "d_3333333333"]);
    expect(s.product.chosenId).toBe("d_2222222222");
    const many = Array.from({ length: 12 }, (_, i) => design(`d_9${String(i).padStart(9, "0")}`));
    s = addDesigns(s, many, "h2");
    expect(s.product.designs.length).toBe(PRODUCT_DESIGNS_MAX);
    expect(s.product.designs.some((d) => d.id === "d_2222222222")).toBe(true);
    expect(s.priv.designs.map((d) => d.id).sort()).toEqual(s.product.designs.map((d) => d.id).sort());
  });

  it("applyCheck keeps the best-scoring checked version; applyPreview makes it final", () => {
    let s = addDesigns({ product: EMPTY_PRODUCT, priv: { designs: [] } }, [design("d_1111111111")], "h");
    const m0 = findDesign(s, "d_1111111111")!.priv.model;
    const m1 = { ...m0, rationale: "patched once" };
    const m2 = { ...m0, rationale: "patched twice" };
    s = applyCheck(s, "d_1111111111", { score: 6, looksLike: "a", missing: ["outlet"], loop: 0, patched: m1, patchedHash: "p1", changed: true, notes: [] });
    let d = findDesign(s, "d_1111111111")!.priv;
    expect(d.best).toEqual({ model: m0, score: 6 });
    expect(d.model).toEqual(m1);
    expect(d.loops).toBe(1);
    s = applyCheck(s, "d_1111111111", { score: 4, looksLike: "b", missing: [], loop: 1, patched: m2, patchedHash: "p2", changed: true, notes: [] });
    d = findDesign(s, "d_1111111111")!.priv;
    expect(d.best!.score).toBe(6);
    expect(d.score).toBe(6);
    expect(finalModel(d)).toEqual(m0);
    s = applyPreview(s, "d_1111111111", "studio-previews/x/d_1111111111.png");
    expect(s.product.designs[0]).toMatchObject({ status: "ready", previewPath: "studio-previews/x/d_1111111111.png" });
    expect(findDesign(s, "d_1111111111")!.priv.model).toEqual(m0);
  });

  it("applyUnlock marks chosen + unlocked", () => {
    const s = applyUnlock(addDesigns({ product: EMPTY_PRODUCT, priv: { designs: [] } }, [design("d_1111111111")], "h"), "d_1111111111");
    expect(s.product).toMatchObject({ chosenId: "d_1111111111", unlockedId: "d_1111111111" });
  });
});
