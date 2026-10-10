import { describe, expect, it } from "vitest";
import { easeExplode, explodeOffset, heightLayers, type ExplodeKind, type Vec3 } from "./explode";

const centre: Vec3 = [0, 0, 0];
const kinds: ExplodeKind[] = ["lid", "base", "component", "extra"];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);

describe("easeExplode", () => {
  it("maps 0→0 and 1→1, clamps outside", () => {
    expect(easeExplode(0)).toBe(0);
    expect(easeExplode(1)).toBe(1);
    expect(easeExplode(-3)).toBe(0);
    expect(easeExplode(7)).toBe(1);
    expect(easeExplode(Number.NaN)).toBe(0);
  });
});

describe("explodeOffset", () => {
  it("is exactly zero at t = 0 for every kind (reversible)", () => {
    for (const k of kinds) {
      expect(explodeOffset(k, [20, -5, 3], centre, 40, 2, 0, [5, 5, 5])).toEqual([0, 0, 0]);
    }
  });

  it("returns to the exact rest position after exploding and collapsing", () => {
    const rest: Vec3 = [12.5, -7.25, 4];
    for (const k of kinds) {
      const out = explodeOffset(k, rest, centre, 50, 1, 1, [0, 30, 0]);
      expect(len(out)).toBeGreaterThan(0);
      const back = explodeOffset(k, rest, centre, 50, 1, 0, [0, 30, 0]);
      expect([rest[0] + back[0], rest[1] + back[1], rest[2] + back[2]]).toEqual(rest);
    }
  });

  it("grows monotonically with t", () => {
    for (const k of kinds) {
      let prev = -1;
      for (let i = 0; i <= 50; i++) {
        const d = len(explodeOffset(k, [10, 10, 2], centre, 60, 2, i / 50, [3, 4, 12]));
        expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = d;
      }
    }
  });

  it("moves the lid up by 0.9·H, the base down by 10 mm", () => {
    expect(explodeOffset("lid", [0, 0, 30], centre, 40, 0, 1)).toEqual([0, 0, 36]);
    expect(explodeOffset("base", [0, 0, 0], centre, 40, 0, 1)).toEqual([0, 0, -10]);
  });

  it("pushes components outwards from the centre and lifts higher layers more", () => {
    const a = explodeOffset("component", [10, 0, 0], centre, 40, 0, 1);
    const b = explodeOffset("component", [-10, 0, 8], centre, 40, 1, 1);
    expect(a[0]).toBeGreaterThan(0);
    expect(b[0]).toBeLessThan(0);
    expect(b[2]).toBeGreaterThan(a[2]);
    // A part at the centre only lifts.
    const c = explodeOffset("component", [0, 0, 0], centre, 40, 0, 1);
    expect(c[0]).toBe(0);
    expect(c[1]).toBe(0);
    expect(c[2]).toBeGreaterThan(0);
  });

  it("uses the caller's vector for extra objects", () => {
    expect(explodeOffset("extra", [1, 2, 3], centre, 40, 0, 1, [0, 0, 25])).toEqual([0, 0, 25]);
    expect(explodeOffset("extra", [1, 2, 3], centre, 40, 0, 1)).toEqual([0, 0, 0]);
  });
});

describe("heightLayers", () => {
  it("ranks by rest z and merges near-equal heights", () => {
    expect(heightLayers([0, 10, 0.2, 5])).toEqual([0, 2, 0, 1]);
    expect(heightLayers([])).toEqual([]);
  });
});
