import { describe, expect, it } from "vitest";
import { CODE_LIBRARY } from "../library";
import type { LayoutInput } from "../layout";
import { clampSpec } from "../schema";
import { archetypeDefault } from "./archetypes";
import { formFrame } from "./forms";
import { applyPatches, clampProductModel, type ProductModel } from "./schema";
import { MK4_BED, solveProduct } from "./solve";

const parts = (...ids: string[]): LayoutInput[] => ids.map((id, i) => ({ instanceId: `${id}_${i + 1}`, part: CODE_LIBRARY.getPart(id)! }));
const spec = clampSpec({ name: "Desk sensor", use: "desk", power: "usb", environment: "indoor", features: [], inputs: ["button"], outputs: ["led"], sizeHint: "palm", style: "rounded", quantity: 1 });

const tiny = (): ProductModel =>
  clampProductModel({
    archetype: "desk_object",
    scene: "desk",
    electronicsHost: "body",
    bodies: [
      { id: "body", role: "housing", form: { kind: "rounded_extrude", w: 30, d: 30, h: 15, r: 8, fillet: 3 }, attach: { to: "ground", anchor: "top" } },
      { id: "lid", role: "lid", form: { kind: "rounded_extrude", w: 30, d: 30, h: 6, r: 8, fillet: 3 }, attach: { to: "body", anchor: "top" } },
    ],
  });

describe("solveProduct", () => {
  it("is deterministic: same input → same output and hash; a change → a new hash", () => {
    const m = archetypeDefault("desk_object", spec, parts("esp32_c3_mini", "led_5mm", "button_6mm"));
    const a = solveProduct(m, parts("esp32_c3_mini", "led_5mm", "button_6mm"), { spec });
    const b = solveProduct(structuredClone(m), parts("esp32_c3_mini", "led_5mm", "button_6mm"), { spec });
    expect(b).toEqual(a);
    expect(a.hash).toMatch(/^prod:/);
    const changed = applyPatches(m, [{ op: "replace", path: "/bodies/1/colour", value: "coral" }]).model;
    expect(solveProduct(changed, parts("esp32_c3_mini", "led_5mm", "button_6mm"), { spec }).hash).not.toBe(a.hash);
    // Part order does not matter.
    expect(solveProduct(m, parts("esp32_c3_mini", "led_5mm", "button_6mm").reverse(), { spec }).hash).toBe(a.hash);
  });

  it("grows the electronics host until the parts fit inside its wall", () => {
    const p = parts("esp32_devkit", "relay_module");
    const s = solveProduct(tiny(), p, { spec });
    const host = s.bodies.find((b) => b.id === "body")!;
    const [w, d] = formFrame(host.form).size;
    expect(Math.max(w, d)).toBeGreaterThan(60);
    expect(Math.min(w, d)).toBeGreaterThan(30);
    expect(s.issues.filter((i) => i.code === "electronics_dont_fit")).toEqual([]);
    expect(s.electronics.map((e) => e.body)).toEqual(["body", "body"]);
    // The stacked lid follows the host's new outline.
    const lid = s.bodies.find((b) => b.id === "lid")!;
    expect(formFrame(lid.form).size[0]).toBe(w);
    // Every part is inside the host's box.
    for (const e of s.electronics) for (let k = 0; k < 3; k++) {
      expect(e.pos[k]).toBeGreaterThanOrEqual(host.box.min[k] - 1e-6);
      expect(e.pos[k]).toBeLessThanOrEqual(host.box.max[k] + 1e-6);
    }
  });

  it("adds homes: pump → reservoir + tube, LED → clear light ring, button → cap", () => {
    const s = solveProduct(tiny(), parts("esp32_c3_mini", "pump_5v", "motor_driver", "led_5mm", "button_6mm"), { spec });
    const roles = s.bodies.map((b) => b.role);
    expect(roles).toContain("reservoir");
    expect(roles).toContain("light_ring");
    expect(roles).toContain("button_cap");
    expect(s.links.some((l) => l.kind === "tube")).toBe(true);
    expect(s.electronics.find((e) => e.partId === "pump_5v")!.body).toBe(s.bodies.find((b) => b.role === "reservoir")!.id);
    expect(s.bodies.find((b) => b.role === "light_ring")!.material).toBe("resin_clear");
    // The cap's stem reaches down to the switch and a hole is cut for it.
    const cap = s.bodies.find((b) => b.role === "button_cap")!;
    expect(cap.form.kind === "button_cap" && cap.form.stem).toBeGreaterThan(0);
    expect(s.bodies.some((b) => b.cutouts.some((c) => c.kind === "stem"))).toBe(true);
    expect(s.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("cuts the USB port on a reachable face and splits a closed shell", () => {
    const s = solveProduct(archetypeDefault("desk_object", spec, parts("esp32_c3_mini")), parts("esp32_c3_mini"), { spec });
    const host = s.bodies.find((b) => b.id === s.model.electronicsHost)!;
    const usb = host.cutouts.find((c) => c.kind === "usb_c")!;
    expect(usb).toBeTruthy();
    // desk products put the socket on the back (+y)
    expect(usb.normal).toEqual([0, 1, 0]);
    expect(s.issues.find((i) => i.code === "usb_unreachable")).toBeUndefined();
    const split = solveProduct(tiny(), parts("esp32_c3_mini"), { spec }).bodies.find((b) => b.id === "body")!;
    expect(["open_top", "split"]).toContain(split.shell);
  });

  it("no floating, everything printable on an MK4", () => {
    const s = solveProduct(tiny(), parts("esp32_c3_mini"), { spec });
    expect(s.issues.filter((i) => i.code === "floating" || i.code === "overlap")).toEqual([]);
    for (const b of s.bodies) {
      for (const p of b.pieces) {
        const [x, y, z] = p.print.size;
        expect(Math.max(x, y)).toBeLessThanOrEqual(MK4_BED.x);
        expect(Math.min(x, y)).toBeLessThanOrEqual(MK4_BED.y);
        expect(z).toBeLessThanOrEqual(MK4_BED.z);
      }
      expect(b.estGrams).toBeGreaterThan(0);
    }
  });

  it("snaps an offset that would make a body float, and reports it", () => {
    const m = tiny();
    m.bodies[1].attach.offset = [0, 0, 25];
    const s = solveProduct(m, [], { spec });
    const body = s.bodies.find((b) => b.id === "body")!;
    const lid = s.bodies.find((b) => b.id === "lid")!;
    expect(lid.box.min[2]).toBeCloseTo(body.box.max[2], 3);
    expect(s.issues.some((i) => i.code === "snapped_offset" && i.body === "lid")).toBe(true);
  });

  it("never throws on junk (seeded fuzz) and stays deterministic", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
    const kinds = ["lathe_profile", "rounded_extrude", "loft_rounded", "stake", "ring", "tank", "nozzle", "enclosure", "knob", "button_cap", "junk"];
    const anchors = ["top", "bottom", "front", "back", "left", "right", "nope"];
    for (let i = 0; i < 40; i++) {
      const n = 1 + Math.floor(rnd() * 9);
      const ids = Array.from({ length: n }, (_, j) => `b${j}`);
      const raw = {
        archetype: pick(["lamp", "handheld", "x"]),
        electronicsHost: pick(ids),
        bodies: ids.map((id, j) => ({
          id,
          role: pick(["housing", "lid", "base", "stake", "cover", "bad"]),
          form: { kind: pick(kinds), w: rnd() * 400 - 50, d: rnd() * 300, h: rnd() * 300, length: rnd() * 300, points: [[rnd() * 80, 0], [rnd() * 80, rnd() * 40], [rnd() * 80, 60]] },
          attach: { to: j === 0 ? "ground" : pick([...ids.slice(0, j), "ground", "scene", "ghost"]), anchor: pick(anchors), offset: [rnd() * 40 - 20, rnd() * 40 - 20, rnd() * 40 - 20] },
          material: pick(["PLA", "petg", "resin_clear", "?"]),
        })),
        links: [{ kind: "tube", from: { body: "b0", anchor: "top" }, to: { body: pick(ids), anchor: "back" } }],
      };
      const p = pick([[], parts("esp32_c3_mini"), parts("esp32_c3_mini", "pump_5v", "led_5mm", "button_6mm", "soil_moisture_cap")]);
      const a = solveProduct(raw, p, { spec });
      expect(a.bodies.length).toBeGreaterThanOrEqual(2);
      expect(solveProduct(raw, p, { spec }).hash).toBe(a.hash);
    }
  });

  it("reports parts it cannot fit (host at its maximum size)", () => {
    const m = clampProductModel({
      archetype: "desk_object",
      bodies: [
        { id: "body", role: "housing", form: { kind: "knob" }, attach: { to: "ground", anchor: "top" } },
        { id: "lid", role: "lid", form: { kind: "foot" }, attach: { to: "body", anchor: "top" } },
      ],
      electronicsHost: "body",
    });
    const s = solveProduct(m, parts("esp32_c3_mini"), { spec });
    expect(s.issues.some((i) => i.code === "electronics_dont_fit")).toBe(true);
    expect(s.unplaced).toEqual(["esp32_c3_mini_1"]);
  });
});
