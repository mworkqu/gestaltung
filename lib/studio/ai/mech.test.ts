import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPart } from "../library";
import { MECH_PARAMS, MechPartSchema, type LayoutItem, type StudioComponent } from "../schema";
import { fakeModel } from "./fake-model";
import { defaultMechParts, layoutBounds, mechSummary } from "./mech-default";
import { runMech } from "./mech";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const components: StudioComponent[] = [
  { partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "Brain" },
  { partId: "cell_18650", instanceId: "cell_18650_1", label: "Battery" },
  { partId: "button_6mm", instanceId: "button_6mm_1", label: "Button" },
  { partId: "led_5mm", instanceId: "led_5mm_1", label: "LED" },
];
const layout: LayoutItem[] = components.map((c, i) => ({ instanceId: c.instanceId, pos: [i * 30, 0, 0], rotZ: 0 }));
const summary = mechSummary({ components, layout, getPart, enclosure: { w: 120, d: 60, h: 35 }, template: "rounded_box" });

describe("defaultMechParts", () => {
  it("standoff per mount hole, clip per cell, extender per button, light pipe per LED, lid + base", () => {
    const parts = defaultMechParts(summary);
    const holes = summary.components.reduce((n, c) => n + c.mountHoles.length, 0);
    const count = (t: string) => parts.filter((p) => p.template === t).length;
    expect(count("standoff")).toBe(holes);
    expect(count("battery_clip")).toBe(1);
    expect(count("button_extender")).toBe(1);
    expect(count("light_pipe")).toBe(1);
    expect(count("lid")).toBe(1);
    expect(count("base")).toBe(1);
    for (const p of parts) expect(MechPartSchema.safeParse(p).success).toBe(true);
    expect(new Set(parts.map((p) => p.id)).size).toBe(parts.length);
  });

  it("layoutBounds measures the placed parts", () => {
    const b = layoutBounds(components, layout, getPart);
    expect(b && b.w).toBeGreaterThan(90);
  });
});

describe("runMech", () => {
  it("valid answer → clamped MechPart[]", async () => {
    const m = fakeModel([
      {
        parts: [
          { id: "s1", template: "standoff", params: { height: 99, outerD: 6, holeD: 2.5 }, forInstance: "esp32_devkit_1", printable: { material: "pla", estGrams: 1 } },
          { template: "lid", params: { width: 120, depth: 60, thickness: 2 }, printable: { material: "PETG", estGrams: 20 } },
        ],
      },
    ]);
    const r = await runMech({ call: m.call, summary });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("model");
    expect(r.value[0].params.height).toBe(MECH_PARAMS.standoff.height[1]);
    expect(r.value[0].printable.material).toBe("PLA");
    expect(r.clampLog.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.value)).not.toContain("path");
  });

  it("unknown template / instance → retry with the problem → valid", async () => {
    const m = fakeModel([
      { parts: [{ template: "rocket", params: {}, printable: { material: "PLA", estGrams: 1 } }] },
      { parts: [{ template: "base", params: {}, printable: { material: "PLA", estGrams: 30 } }] },
    ]);
    const r = await runMech({ call: m.call, summary });
    expect(r.ok && r.value[0].template).toBe("base");
    expect(m.prompts[1]).toContain("template must be one of");
  });

  it("invalid twice → the deterministic list", async () => {
    const m = fakeModel(["nope", { parts: "nope" }]);
    const r = await runMech({ call: m.call, summary });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("default");
    expect(r.value).toEqual(defaultMechParts(summary));
  });
});
