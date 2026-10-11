import { describe, expect, it } from "vitest";

import { footprint, PLATE_LIFT, platePlacements } from "./plate";
import { partsPictureKey, spreadSpots } from "./client/parts-picture";
import { getPart } from "./library";
import type { LibraryPart } from "./schema";

const dims = (x: number, y: number, z: number) => ({ dims: { x, y, z } });

describe("platePlacements (shared by the 3D viewer and the worker's parts picture)", () => {
  it("places every part once, on the plate, inside its radius, without overlaps", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => ({ instanceId: id, partId: id }));
    const parts = new Map([
      ["a", dims(60, 30, 10)],
      ["b", dims(20, 20, 8)],
      ["c", dims(40, 25, 6)],
      ["d", dims(10, 10, 4)],
      ["e", dims(35, 35, 20)],
    ]);
    const { placements, radius } = platePlacements(items, parts);
    expect(placements.map((p) => p.c.instanceId).sort()).toEqual(["a", "b", "c", "d", "e"]);
    for (const p of placements) {
      const f = footprint(parts.get(p.c.instanceId));
      expect(p.pos[2]).toBe(PLATE_LIFT);
      expect(Math.hypot(Math.abs(p.pos[0]) + f.w / 2, Math.abs(p.pos[1]) + f.d / 2)).toBeLessThanOrEqual(radius);
    }
    for (let i = 0; i < placements.length; i++)
      for (let j = i + 1; j < placements.length; j++) {
        const A = placements[i];
        const B = placements[j];
        const fa = footprint(parts.get(A.c.instanceId));
        const fb = footprint(parts.get(B.c.instanceId));
        const apart = Math.abs(A.pos[0] - B.pos[0]) >= (fa.w + fb.w) / 2 - 1e-6 || Math.abs(A.pos[1] - B.pos[1]) >= (fa.d + fb.d) / 2 - 1e-6;
        expect(apart).toBe(true);
      }
  });

  it("is deterministic and has a default radius when empty", () => {
    expect(platePlacements([], new Map()).radius).toBe(60);
    const items = [{ instanceId: "x", partId: "x" }];
    const parts = new Map([["x", dims(20, 10, 5)]]);
    expect(platePlacements(items, parts)).toEqual(platePlacements(items, parts));
  });
});

describe("spreadSpots", () => {
  it("pushes close tap targets at least minPx apart, inside the box, order kept", () => {
    const spots = [
      { id: "a", x: 0.5, y: 0.5 },
      { id: "b", x: 0.5, y: 0.5 },
      { id: "c", x: 0.52, y: 0.51 },
      { id: "d", x: 0.0, y: 1.0 },
    ];
    const out = spreadSpots(spots, 400, 300, 44);
    expect(out.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    for (let i = 0; i < out.length; i++) {
      expect(out[i].x * 400).toBeGreaterThanOrEqual(22 - 1e-6);
      expect(out[i].y * 300).toBeLessThanOrEqual(300 - 22 + 1e-6);
      for (let j = i + 1; j < out.length; j++)
        expect(Math.hypot((out[i].x - out[j].x) * 400, (out[i].y - out[j].y) * 300)).toBeGreaterThanOrEqual(43.5);
    }
  });
  it("leaves spots that are already apart alone", () => {
    const spots = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }];
    expect(spreadSpots(spots, 400, 300)).toEqual(spots);
  });
});

describe("partsPictureKey", () => {
  const board = getPart("esp32_devkit") ?? (getPart("arduino_uno") as LibraryPart);
  it("changes with the parts and the box, not between calls", () => {
    const a = partsPictureKey([["u1", board]], 800, 560, "#0ea5a4");
    expect(partsPictureKey([["u1", board]], 800, 560, "#0ea5a4")).toBe(a);
    expect(partsPictureKey([["u2", board]], 800, 560, "#0ea5a4")).not.toBe(a);
    expect(partsPictureKey([["u1", board]], 840, 560, "#0ea5a4")).not.toBe(a);
  });
});
