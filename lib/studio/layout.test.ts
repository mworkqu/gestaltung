import { describe, expect, it } from "vitest";
import { layoutComponents, primarySideFace, rotateFace, worldBox, type LayoutResult } from "./layout";
import type { LibraryPart } from "./schema";
import { P, items, typical } from "./enclosure/test-fixtures";

const partMap = (list: { instanceId: string; part: LibraryPart }[]) => new Map(list.map((i) => [i.instanceId, i.part]));

function shuffle<T>(a: T[], seed: number): T[] {
  const out = [...a];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function checkNoOverlap(r: LayoutResult, parts: Map<string, LibraryPart>, minC: number) {
  const boxes = r.layout.map((it) => ({ it, part: parts.get(it.instanceId)!, box: worldBox(it, parts.get(it.instanceId)!) }));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const gap = Math.max(minC, a.part.clearance, b.part.clearance) - 1e-6;
      const sepX = Math.max(b.box.min[0] - a.box.max[0], a.box.min[0] - b.box.max[0]);
      const sepY = Math.max(b.box.min[1] - a.box.max[1], a.box.min[1] - b.box.max[1]);
      const sepZ = Math.max(b.box.min[2] - a.box.max[2], a.box.min[2] - b.box.max[2]);
      const ok = sepX >= gap || sepY >= gap || sepZ > 0; // z: battery-under-board stacking
      expect(ok, `${a.it.instanceId} vs ${b.it.instanceId}`).toBe(true);
    }
  }
}

describe("layoutComponents", () => {
  it("is deterministic and order independent", () => {
    const a = layoutComponents(typical(), { clearance: 2 });
    const b = layoutComponents(typical(), { clearance: 2 });
    expect(b).toEqual(a);
    for (const seed of [1, 7, 42, 99]) expect(layoutComponents(shuffle(typical(), seed), { clearance: 2 })).toEqual(a);
  });

  it("keeps clearance between parts", () => {
    const list = typical();
    for (const c of [1, 2, 4]) checkNoOverlap(layoutComponents(list, { clearance: c }), partMap(list), c);
  });

  it("pushes side-port parts to their face of the bounding box", () => {
    const list = typical();
    const r = layoutComponents(list, { clearance: 2 });
    const parts = partMap(list);
    let checked = 0;
    for (const it of r.layout) {
      const part = parts.get(it.instanceId)!;
      const f = primarySideFace(part);
      if (!f) continue;
      const face = rotateFace(f, it.rotZ);
      const box = worldBox(it, part);
      const axis = face[1] === "x" ? 0 : 1;
      const want = face[0] === "+" ? r.bbox.max[axis] : r.bbox.min[axis];
      const got = face[0] === "+" ? box.max[axis] : box.min[axis];
      expect(got, `${it.instanceId} ${face}`).toBeCloseTo(want, 3);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(4);
  });

  it("stacks the battery under the board on standoffs", () => {
    const list = typical();
    const r = layoutComponents(list);
    const parts = partMap(list);
    const bat = r.layout.find((i) => i.instanceId === "b1")!;
    const brd = r.layout.find((i) => i.instanceId === "u1")!;
    const bb = worldBox(bat, parts.get("b1")!);
    const ub = worldBox(brd, parts.get("u1")!);
    expect(brd.pos[2]).toBeCloseTo(P.lipo.dims.z + 2, 6);
    expect(bb.min[0]).toBeGreaterThanOrEqual(ub.min[0] - 1e-6);
    expect(bb.max[0]).toBeLessThanOrEqual(ub.max[0] + 1e-6);
    expect(bb.max[2]).toBeLessThan(ub.min[2]);
  });

  it("places a battery that does not fit beside the board", () => {
    const list = items(["u1", P.board], ["c1", P.bigCell]);
    const r = layoutComponents(list);
    const cell = r.layout.find((i) => i.instanceId === "c1")!;
    expect(cell.pos[2]).toBe(0);
    checkNoOverlap(r, partMap(list), 1);
  });

  it("raises +z port parts to the tallest stack and skips port-less helpers", () => {
    const list = typical();
    const r = layoutComponents(list);
    const parts = partMap(list);
    expect(r.layout.some((i) => i.instanceId === "r1")).toBe(false);
    expect(r.layout.some((i) => i.instanceId === "l1")).toBe(true);
    for (const id of ["d1", "k1", "l1", "sp1"]) {
      const it = r.layout.find((i) => i.instanceId === id)!;
      expect(worldBox(it, parts.get(id)!).max[2]).toBeCloseTo(r.height, 6);
    }
  });

  it("centres the bbox on the XY origin from z = 0", () => {
    const r = layoutComponents(typical());
    expect(r.bbox.min[0] + r.bbox.max[0]).toBeCloseTo(0, 3);
    expect(r.bbox.min[1] + r.bbox.max[1]).toBeCloseTo(0, 3);
    expect(r.bbox.min[2]).toBe(0);
    expect(r.footprint.w).toBeCloseTo(r.bbox.max[0] - r.bbox.min[0], 6);
    const ratio = r.footprint.w / r.footprint.d;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(3);
  });

  it("handles an empty list", () => {
    expect(layoutComponents([]).layout).toEqual([]);
  });
});
