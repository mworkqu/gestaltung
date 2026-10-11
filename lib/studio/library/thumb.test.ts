import { describe, expect, it } from "vitest";
import { isoBox, shade } from "./thumb";

describe("isoBox", () => {
  it("fits inside the square and keeps three faces", () => {
    const b = isoBox({ x: 50, y: 20, z: 10 }, 56);
    expect(b.width).toBeLessThanOrEqual(56);
    expect(b.height).toBeLessThanOrEqual(56);
    expect(b.top.split(" ")).toHaveLength(4);
    expect(b.left.split(" ")).toHaveLength(4);
    expect(b.right.split(" ")).toHaveLength(4);
  });
  it("a tall part is taller than a flat one", () => {
    const tall = isoBox({ x: 10, y: 10, z: 40 });
    const flat = isoBox({ x: 40, y: 40, z: 2 });
    expect(tall.height / tall.width).toBeGreaterThan(flat.height / flat.width);
  });
  it("survives zero dims", () => {
    expect(() => isoBox({ x: 0, y: 0, z: 0 })).not.toThrow();
  });
});

describe("shade", () => {
  it("darkens and lightens, ignores junk", () => {
    expect(shade("#808080", 0.5)).toBe("#404040");
    expect(shade("#808080", 3)).toBe("#ffffff");
    expect(shade("red", 0.5)).toBe("red");
  });
});
