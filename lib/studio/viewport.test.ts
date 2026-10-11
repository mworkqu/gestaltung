import { describe, expect, it } from "vitest";

import {
  clampPan,
  clampScale,
  fitTransform,
  MAX_SCALE,
  minScaleFor,
  parseViewBox,
  percentLabel,
  pinchTransform,
  textFloorScale,
  zoomAt,
  zoomBy,
} from "./viewport";

const view = { w: 1000, h: 600 };

describe("fitTransform", () => {
  it("fits the whole drawing, centred, with padding", () => {
    const f = fitTransform(view, { w: 800, h: 400 }, 20);
    expect(f.mode).toBe("both");
    // limited by width: (1000 - 40) / 800 = 1.2
    expect(f.scale).toBeCloseTo(1.2);
    expect(f.x).toBeCloseTo((1000 - 800 * 1.2) / 2);
    expect(f.y).toBeCloseTo((600 - 400 * 1.2) / 2);
  });

  it("is limited by height when the drawing is tall", () => {
    const f = fitTransform(view, { w: 400, h: 500 }, 20);
    expect(f.scale).toBeCloseTo((600 - 40) / 500);
    expect(f.mode).toBe("both");
  });

  it("never zooms in past MAX_SCALE", () => {
    expect(fitTransform(view, { w: 10, h: 10 }).scale).toBe(MAX_SCALE);
  });

  it("keeps text readable: fits the width only when fitting both would be too small", () => {
    const phone = { w: 375, h: 400 };
    const tall = { w: 600, h: 1400 }; // both-fit would be 0.26, below the 0.9 floor
    const f = fitTransform(phone, tall, 16);
    expect(f.mode).toBe("width");
    expect(f.scale).toBeCloseTo((375 - 32) / 600);
    expect(f.y).toBe(16);
  });

  it("text floor is 9px over the smallest 10-unit font", () => {
    expect(textFloorScale()).toBeCloseTo(0.9);
  });
});

describe("minScaleFor", () => {
  it("is the floor, but never above Fit so Fit is always reachable", () => {
    expect(minScaleFor({ scale: 1.5, x: 0, y: 0, mode: "both" })).toBeCloseTo(0.9);
    expect(minScaleFor({ scale: 0.4, x: 0, y: 0, mode: "width" })).toBeCloseTo(0.4);
  });
});

describe("clampScale", () => {
  it("clamps both ends and survives NaN", () => {
    expect(clampScale(0.1, 0.5)).toBe(0.5);
    expect(clampScale(99, 0.5)).toBe(MAX_SCALE);
    expect(clampScale(NaN, 0.5)).toBe(0.5);
  });
});

describe("zoomAt", () => {
  it("keeps the content point under the cursor fixed", () => {
    const t = { scale: 1, x: 100, y: 50 };
    const anchor = { x: 400, y: 300 };
    const content = { x: (anchor.x - t.x) / t.scale, y: (anchor.y - t.y) / t.scale };
    const z = zoomAt(t, 2, anchor, 0.5);
    expect(z.scale).toBe(2);
    expect(content.x * z.scale + z.x).toBeCloseTo(anchor.x);
    expect(content.y * z.scale + z.y).toBeCloseTo(anchor.y);
  });

  it("clamps to the minimum and anchors with the clamped scale", () => {
    const t = { scale: 1, x: 0, y: 0 };
    const z = zoomAt(t, 0.01, { x: 200, y: 100 }, 0.9);
    expect(z.scale).toBe(0.9);
    expect(z.x).toBeCloseTo(200 - 200 * 0.9);
  });

  it("zoomBy multiplies the scale", () => {
    expect(zoomBy({ scale: 1, x: 0, y: 0 }, 1.25, { x: 0, y: 0 }, 0.5).scale).toBeCloseTo(1.25);
  });
});

describe("pinchTransform", () => {
  it("scales by the finger distance and follows the midpoint", () => {
    const t = { scale: 1, x: 0, y: 0 };
    const start = { t, mid: { x: 100, y: 100 }, dist: 100 };
    const next = pinchTransform(start, { mid: { x: 100, y: 100 }, dist: 200 }, 0.5);
    expect(next.scale).toBe(2);
    // The content point that was under the midpoint stays under it.
    expect(100 * next.scale + next.x).toBeCloseTo(100);
    // Moving the midpoint pans.
    const moved = pinchTransform(start, { mid: { x: 150, y: 120 }, dist: 100 }, 0.5);
    expect(moved.scale).toBe(1);
    expect(moved.x).toBeCloseTo(50);
    expect(moved.y).toBeCloseTo(20);
  });

  it("clamps the scale and ignores a zero start distance", () => {
    const t = { scale: 1, x: 0, y: 0 };
    expect(pinchTransform({ t, mid: { x: 0, y: 0 }, dist: 10 }, { mid: { x: 0, y: 0 }, dist: 1 }, 0.9).scale).toBe(0.9);
    expect(pinchTransform({ t, mid: { x: 0, y: 0 }, dist: 0 }, { mid: { x: 0, y: 0 }, dist: 50 }, 0.9).scale).toBe(1);
  });
});

describe("clampPan", () => {
  const content = { w: 800, h: 400 };
  it("small drawings stay inside the view", () => {
    const c = clampPan({ scale: 1, x: -500, y: 900 }, view, content, 16);
    expect(c.x).toBe(16);
    expect(c.y).toBe(600 - 16 - 400);
  });
  it("large drawings cannot be dragged out of reach", () => {
    const c = clampPan({ scale: 2, x: 500, y: -5000 }, view, content, 16);
    expect(c.x).toBe(16);
    expect(c.y).toBe(600 - 16 - 800);
  });
  it("leaves a valid position alone", () => {
    const t = { scale: 2, x: -200, y: -100 };
    expect(clampPan(t, view, content, 16)).toEqual(t);
  });
});

describe("labels and parsing", () => {
  it("formats the zoom percent", () => {
    expect(percentLabel(1)).toBe("100%");
    expect(percentLabel(0.376)).toBe("38%");
  });
  it("reads the drawing size from the viewBox", () => {
    expect(parseViewBox('<svg viewBox="0 0 920.5 480" width="100%">')).toEqual({ w: 920.5, h: 480 });
    expect(parseViewBox("<svg>")).toBeNull();
    expect(parseViewBox('<svg viewBox="0 0 0 0">')).toBeNull();
  });
});
