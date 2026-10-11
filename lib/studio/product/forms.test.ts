import { describe, expect, it } from "vitest";
import {
  FORM_KINDS,
  MIN_LATHE_SEGMENTS,
  anchorPoint,
  boxFits,
  clampForm,
  defaultForm,
  type FormPart,
  fitHeight,
  formFrame,
  insideSection,
  matchOutline,
  overhangDeg,
  scaleForm,
  sectionAt,
  stackOutline,
  topAt,
} from "./forms";
import { ENCLOSURE_TEMPLATES } from "../schema";
import { latheOutline, outlineOverhangDeg } from "./shapes";

describe("form-part kit", () => {
  it("has the spec's kinds plus the wrapped enclosure templates", () => {
    for (const k of ["lathe_profile", "rounded_extrude", "loft_rounded", "stake", "prongs", "tube_sweep", "nozzle", "ring", "tank", "button_cap", "knob", "grille_disc", "foot", "clip_arm", "hook", "hinge_lid", "enclosure"]) {
      expect(FORM_KINDS).toContain(k);
    }
    for (const t of ENCLOSURE_TEMPLATES) {
      const f = clampForm({ kind: "enclosure", template: t, w: 90, d: 60, h: 40 });
      expect(f.kind === "enclosure" && f.template).toBe(t);
      const [w, d, h] = formFrame(f).size;
      expect(w).toBeGreaterThan(0);
      expect(d).toBeGreaterThan(0);
      expect(h).toBe(40);
    }
  });

  it("defaults clamp to themselves and have a positive frame", () => {
    for (const kind of FORM_KINDS) {
      const f = defaultForm(kind) as FormPart;
      expect(clampForm(f)).toEqual(f);
      for (const s of formFrame(f).size) expect(s).toBeGreaterThan(0);
    }
  });

  it("lathed parts keep ≥ 64 radial segments", () => {
    expect(clampForm({ kind: "lathe_profile", segments: 8 })).toMatchObject({ segments: MIN_LATHE_SEGMENTS });
  });

  it("anchors sit on the surface (round head: at its widest height)", () => {
    const head = clampForm({ kind: "lathe_profile", points: [[30, 0], [40, 10], [40, 30], [0, 40]], round: 3 });
    const front = anchorPoint(head, "front");
    expect(front.p[1]).toBeCloseTo(-40, 1);
    expect(front.p[2]).toBeGreaterThan(9);
    expect(front.p[2]).toBeLessThan(31);
    // Sliding along a round face stays on the surface.
    const side = anchorPoint(head, "front", 20);
    expect(Math.hypot(side.p[0], side.p[1])).toBeCloseTo(40, 1);
    expect(anchorPoint(head, "top").p[2]).toBeCloseTo(40, 1);
    expect(topAt(head, 0, 0)).toBeCloseTo(40, 1);
    const box = clampForm({ kind: "rounded_extrude", w: 80, d: 60, h: 30 });
    expect(anchorPoint(box, "left").p).toEqual([-40, 0, 15]);
    expect(anchorPoint(box, "back").n).toEqual([0, 1, 0]);
  });

  it("sections and fits: a box fits a round section by its diagonal", () => {
    expect(boxFits({ kind: "round", r: 10 }, 14, 14)).toBe(true);
    expect(boxFits({ kind: "round", r: 10 }, 16, 16)).toBe(false);
    expect(boxFits({ kind: "box", hw: 10, hd: 10, rc: 5 }, 20, 10)).toBe(true);
    expect(boxFits({ kind: "box", hw: 10, hd: 10, rc: 5 }, 20, 20)).toBe(false);
    expect(insideSection({ kind: "box", hw: 10, hd: 10, rc: 5 }, 9.9, 0)).toBe(true);
    const cup = clampForm({ kind: "lathe_profile", points: [[30, 0], [40, 10], [40, 40]], round: 3 });
    expect(sectionAt(cup, 20, 2)).toEqual({ kind: "round", r: 38 });
    expect(fitHeight(cup, 50, 40, 15, 2, 40)).not.toBeNull();
    expect(fitHeight(cup, 80, 40, 15, 2, 40)).toBeNull();
  });

  it("grows and matches outlines", () => {
    const f = clampForm({ kind: "rounded_extrude", w: 50, d: 40, h: 20 });
    const g = scaleForm(f, 1.2, 1.5, 2);
    expect(g).toMatchObject({ w: 60, d: 60, h: 40 });
    const ring = matchOutline(clampForm({ kind: "ring", w: 20, t: 3 }), "bottom", stackOutline(clampForm({ kind: "lathe_profile", points: [[30, 0], [38, 10], [41, 30]] }), "top")!);
    expect(formFrame(ring).size[0]).toBeCloseTo(82, 3);
  });

  it("overhang: flaring outwards fails upright, a cone narrowing up passes", () => {
    const flare = latheOutline([[10, 0], [40, 10], [40, 20]], 1);
    expect(outlineOverhangDeg(flare)).toBeGreaterThan(60);
    const cone = latheOutline([[40, 0], [10, 30], [0, 31]], 1);
    expect(outlineOverhangDeg(cone)).toBeLessThanOrEqual(1);
    expect(outlineOverhangDeg(cone, true)).toBeGreaterThan(45);
    expect(overhangDeg(clampForm({ kind: "stake" }), "flipped")).toBe(0);
  });
});
