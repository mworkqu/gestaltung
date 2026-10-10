import { afterEach, describe, expect, it } from "vitest";
import { layoutComponents, layoutResultOf } from "../layout";
import { getPart } from "../library";
import type { LibraryPart, StudioComponent } from "../schema";
import { buildEnclosure } from "../enclosure/build";
import { spec } from "../enclosure/test-fixtures";
import { defaultMechParts, mechSummary } from "../ai/mech-default";
import { exportObjectsSTL } from "../export";
import { enclosureMeshes, geometryStats, getEnclosureGeometry, getMechGeometry, mechObjects, resetGeometryClientForTests } from "./client";
import { enclosureKey, hashText, mechKey, stableJson } from "./key";
import { packGeometry, transferablesOf, unpackGeometry } from "./pack";
import { handleRequest } from "./job";

function scene(ids: [string, string][] = [["u1", "arduino_uno"], ["m1", "pir_hcsr501"], ["k1", "button_6mm"], ["l1", "led_5mm"]]) {
  const list = ids.map(([instanceId, partId]) => ({ instanceId, part: getPart(partId)! }));
  const parts = new Map<string, LibraryPart>(list.map((i) => [i.instanceId, i.part]));
  const lr = layoutResultOf(layoutComponents(list, { clearance: 2 }).layout, parts);
  return { parts, lr, components: ids.map(([instanceId, partId]) => ({ instanceId, partId }) as StudioComponent) };
}

afterEach(() => {
  resetGeometryClientForTests();
});

describe("geometry keys", () => {
  it("stableJson ignores key order and undefined", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: undefined } })).toBe(stableJson({ a: { d: 2 }, b: 1 }));
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });

  it("colour / finish / accent never change the enclosure key; shape and label do", () => {
    const { parts, lr } = scene();
    const base = enclosureKey(spec(), lr, parts);
    expect(enclosureKey(spec({ colour: "coral", finish: "glossy_plastic", accentColour: "sun" }), lr, parts)).toBe(base);
    expect(enclosureKey(spec({ label: "DESK BUDDY" }), lr, parts)).not.toBe(base);
    expect(enclosureKey(spec({ template: "dome_base" }), lr, parts)).not.toBe(base);
    expect(mechKey(base, [])).not.toBe(mechKey(base, [], "outdoor"));
  });
});

describe("pack / unpack", () => {
  it("round-trips an enclosure mesh exactly and lists each buffer once", () => {
    const { parts, lr } = scene();
    const enc = buildEnclosure(spec(), lr, parts);
    const packed = packGeometry(enc.lid.geometry);
    const g = unpackGeometry(packed);
    expect(Array.from(g.getAttribute("position").array)).toEqual(Array.from(enc.lid.geometry.getAttribute("position").array));
    expect(g.getIndex()?.count).toBe(enc.lid.geometry.getIndex()?.count);
    expect(g.groups).toEqual(enc.lid.geometry.groups);
    expect(transferablesOf([packed, packed]).length).toBe(packed.index ? 3 : 2);
  });
});

describe("geometry client (no Worker → same job on the main thread)", () => {
  it("builds the enclosure with its plan, caches it, and a colour change reuses the same build", async () => {
    const { parts, lr } = scene();
    const a = getEnclosureGeometry(spec(), lr, parts);
    const b = getEnclosureGeometry(spec({ colour: "graphite", finish: "soft_touch" }), lr, parts);
    expect(b).toBe(a);
    const g = await a;
    expect(geometryStats.main).toBe(1);
    expect(g.meta.layout.length).toBe(4);
    expect(g.meta.cutouts.length).toBeGreaterThan(0);
    expect(g.base.getAttribute("position").count).toBeGreaterThan(100);
    // Same numbers as a direct build (the plan + triangles travel with the result).
    const direct = buildEnclosure(spec(), lr, parts);
    expect(g.meta.triangles).toBe(direct.meta.triangles);
    expect(g.meta.W).toBe(direct.meta.W);

    const meshes = enclosureMeshes(g);
    expect(meshes.base.name).toBe("enclosure_base");
    expect(meshes.lid.name).toBe("enclosure_lid");
    expect(meshes.base.children.length).toBe(direct.base.children.length);
    // Fresh meshes each call, over the same cached geometry.
    const again = enclosureMeshes(g);
    expect(again.lid).not.toBe(meshes.lid);
    expect(again.lid.geometry).toBe(meshes.lid.geometry);
    // STL export still works from the rebuilt meshes.
    const files = exportObjectsSTL([meshes.base, meshes.lid]);
    expect(files.map((f) => f.name)).toEqual(["enclosure_base.stl", "enclosure_lid.stl"]);
    expect((files[1].data as ArrayBuffer).byteLength).toBe(84 + 50 * direct.lid.geometry.getIndex()!.count / 3);
  });

  it("a label is raised (or skipped with a reason) and travels in meta", async () => {
    const { parts, lr } = scene();
    const ok = await getEnclosureGeometry(spec({ label: "DESK BUDDY" }), lr, parts);
    expect(ok.meta.label?.text).toBe("DESK BUDDY");
    const ar = await getEnclosureGeometry(spec({ label: "مرحبا" }), lr, parts);
    expect(ar.meta.label).toBeNull();
    expect(ar.meta.labelSkipped).toBe("script");
  });

  it("builds the printed parts next to the cached case; lid / base reuse the case geometry", async () => {
    const { parts, lr, components } = scene();
    const enc = await getEnclosureGeometry(spec(), lr, parts);
    const mech = defaultMechParts(
      mechSummary({ components, layout: lr.layout, getPart: (id) => getPart(id), enclosure: { w: enc.meta.W, d: enc.meta.D, h: enc.meta.H } }),
    );
    const m = await getMechGeometry(spec({ colour: "coral" }), lr, parts, mech);
    const list = mechObjects(m, enc);
    expect(list.length).toBe(mech.length);
    const lid = list.find((b) => b.template === "lid");
    expect(lid && (lid.object as unknown as { geometry: unknown }).geometry).toBe(enc.lid);
    for (const b of list) expect(b.printable.estGrams).toBeGreaterThan(0);
    expect(await getMechGeometry(spec(), lr, parts, mech)).toBe(m);
  });

  it("a failing job answers ok:false instead of throwing", () => {
    const r = handleRequest({ id: 7, kind: "enclosure", key: "x", input: { spec: spec(), layout: null as never, parts: [] } });
    expect(r.reply).toMatchObject({ id: 7, ok: false });
  });
});
