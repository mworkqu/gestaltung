import { describe, expect, it } from "vitest";
import {
  BASE_DROP_MM,
  componentLiftMm,
  easeExplode,
  explodeFrame,
  explodeOffset,
  heightLayers,
  lidLiftMm,
  type ExplodeFrame,
  type ExplodeKind,
  type Vec3,
} from "./explode";

const kinds: ExplodeKind[] = ["lid", "base", "component", "extra"];
const len = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
const frame = (o: Partial<ExplodeFrame> = {}): ExplodeFrame => ({ centre: [0, 0, 0], H: 40, tallest: 18, layers: 3, span: 80, ...o });

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
      expect(explodeOffset(k, [20, -5, 3], frame(), 2, 0, [5, 5, 5])).toEqual([0, 0, 0]);
    }
  });

  it("returns to the exact rest position after exploding and collapsing", () => {
    const rest: Vec3 = [12.5, -7.25, 4];
    for (const k of kinds) {
      const out = explodeOffset(k, rest, frame({ H: 50 }), 1, 1, [0, 30, 0]);
      expect(len(out)).toBeGreaterThan(0);
      const back = explodeOffset(k, rest, frame({ H: 50 }), 1, 0, [0, 30, 0]);
      expect([rest[0] + back[0], rest[1] + back[1], rest[2] + back[2]]).toEqual(rest);
    }
  });

  it("grows monotonically with t", () => {
    for (const k of kinds) {
      let prev = -1;
      for (let i = 0; i <= 50; i++) {
        const d = len(explodeOffset(k, [10, 10, 2], frame({ H: 60 }), 2, i / 50, [3, 4, 12]));
        expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = d;
      }
    }
  });

  it("lifts the lid well above everything; the base only drops a little", () => {
    const f = frame({ H: 40, tallest: 18 });
    const lid = explodeOffset("lid", [0, 0, 30], f, 0, 1);
    expect(lid[2]).toBeCloseTo(lidLiftMm(40, 18), 9);
    expect(lid[2]).toBeGreaterThanOrEqual(1.2 * 40 + 18);
    expect(lid[2]).toBeLessThanOrEqual(1.5 * 40 + 18);
    expect(explodeOffset("base", [0, 0, 0], f, 0, 1)).toEqual([0, 0, -BASE_DROP_MM]);
    expect(BASE_DROP_MM).toBeLessThanOrEqual(10);
    // The highest component layer (bottom resting on the floor, the tallest part) stays under
    // the raised lid, whose bottom starts at the base top (default 0.7 · H).
    const highestTop = componentLiftMm(f, f.layers - 1, 0) + f.tallest;
    expect(highestTop).toBeLessThan(0.7 * f.H + lid[2] - 0.2 * f.H);
  });

  it("pushes components outwards from the centre and lifts higher layers more", () => {
    const f = frame();
    const a = explodeOffset("component", [10, 0, 0], f, 0, 1);
    const b = explodeOffset("component", [-10, 0, 8], f, 1, 1);
    expect(a[0]).toBeGreaterThan(0);
    expect(b[0]).toBeLessThan(0);
    expect(b[2]).toBeGreaterThan(a[2]);
    // Components rise out of the base: even the lowest layer's bottom clears the base top.
    expect(0 + a[2]).toBeGreaterThan(0.7 * f.H);
    expect(8 + b[2]).toBeGreaterThan(0 + a[2]);
    // A part already high up still lifts.
    expect(componentLiftMm(f, 2, 60)).toBeGreaterThanOrEqual(0.35 * f.H);
    // A part at the centre only lifts.
    const c = explodeOffset("component", [0, 0, 0], f, 0, 1);
    expect(c[0]).toBe(0);
    expect(c[1]).toBe(0);
    expect(c[2]).toBeGreaterThan(0);
  });

  it("uses the caller's vector for extra objects", () => {
    expect(explodeOffset("extra", [1, 2, 3], frame(), 0, 1, [0, 0, 25])).toEqual([0, 0, 25]);
    expect(explodeOffset("extra", [1, 2, 3], frame(), 0, 1)).toEqual([0, 0, 0]);
  });
});

describe("heightLayers", () => {
  it("ranks by rest z and merges near-equal heights", () => {
    expect(heightLayers([0, 10, 0.2, 5])).toEqual([0, 2, 0, 1]);
    expect(heightLayers([])).toEqual([]);
  });
});

describe("explodeFrame", () => {
  it("centres on the footprint, counts layers and finds the tallest part", () => {
    const { frame: f, layers } = explodeFrame(
      [
        { pos: [-20, 0, 0], w: 40, d: 20, h: 10 },
        { pos: [20, 5, 12], w: 20, d: 30, h: 18 },
      ],
      40,
    );
    expect(f.centre).toEqual([-5, 5, 0]);
    expect(f.tallest).toBe(18);
    expect(f.layers).toBe(2);
    expect(f.span).toBe(70);
    expect(layers).toEqual([0, 1]);
    expect(explodeFrame([], 30).frame.layers).toBe(1);
  });
});
