import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ENCLOSURE, DEFAULT_SPEC, EnclosureSpecSchema, type EnclosureSpec } from "../schema";
import { fakeModel } from "./fake-model";
import { runEnclosure, safeBbox } from "./enclosure";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const LOOK = {
  template: "pill",
  proportions: { widthToDepth: 1.6, heightBias: "low" },
  cornerRadius: 10,
  edgeFillet: 2,
  wall: 2,
  clearance: 2,
  lid: "snap",
  vents: { pattern: "slots", face: "-z", count: 6 },
  feet: "rubber_4",
  finish: "soft_touch",
  colour: "sage",
};
const base = { spec: DEFAULT_SPEC, components: [{ name: "ESP32", category: "mcu" }], bbox: { w: 80, d: 50, h: 30 } };

describe("runEnclosure", () => {
  it("valid answer → a valid EnclosureSpec", async () => {
    const m = fakeModel([LOOK]);
    const r = await runEnclosure({ call: m.call, ...base });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("model");
    expect(EnclosureSpecSchema.safeParse(r.value).success).toBe(true);
    expect(r.value.template).toBe("pill");
    expect(m.temperatures[0]).toBe(0.2);
  });

  it("clamps out-of-range numbers (and the corner radius to the footprint)", async () => {
    const m = fakeModel([{ ...LOOK, wall: 9, cornerRadius: 50, clearance: -3, vents: { pattern: "holes", face: "+z", count: 99 } }]);
    const r = await runEnclosure({ call: m.call, ...base, bbox: { w: 30, d: 20, h: 20 } });
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.wall).toBe(4);
    expect(r.value.clearance).toBe(1);
    expect(r.value.vents.count).toBe(24);
    expect(r.value.cornerRadius).toBeCloseTo(6.6);
    expect(r.clampLog.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.value)).not.toContain("path");
  });

  it("template outside the allowed list → retry with the problem → valid", async () => {
    const m = fakeModel([{ ...LOOK, template: "cube" }, LOOK]);
    const r = await runEnclosure({ call: m.call, ...base });
    expect(r.ok && r.value.template).toBe("pill");
    expect(m.prompts[1]).toContain("template must be one of: rounded_box, pill, soft_wedge, puck, handheld_taper, lantern, dome_base, wall_plate");
  });

  it("'Try another look': the same look again is rejected and the prompt asks for a different one", async () => {
    const shown = EnclosureSpecSchema.parse({ ...LOOK });
    const m = fakeModel([LOOK, { ...LOOK, colour: "coral" }]);
    const r = await runEnclosure({ call: m.call, ...base, previous: [shown] });
    expect(r.ok && r.value.colour).toBe("coral");
    expect(m.prompts[0]).toContain("Choose a DIFFERENT template or a different colour");
    expect(m.prompts[1]).toContain("already shown");
  });

  it("invalid twice → the caller's default, made different from earlier looks", async () => {
    const m = fakeModel(["x", { template: 7 }]);
    const r = await runEnclosure({ call: m.call, ...base, previous: [DEFAULT_ENCLOSURE] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("default");
    expect(r.value.template).toBe(DEFAULT_ENCLOSURE.template);
    expect(r.value.colour).not.toBe(DEFAULT_ENCLOSURE.colour);
    expect(EnclosureSpecSchema.safeParse(r.value).success).toBe(true);
  });

  it("uses the injected fallback (templateFor) when given", async () => {
    const fallback: EnclosureSpec = { ...DEFAULT_ENCLOSURE, template: "puck", lid: "twist" };
    const m = fakeModel(["x", "y"]);
    const r = await runEnclosure({ call: m.call, ...base, fallback });
    expect(r.ok && r.value.template).toBe("puck");
  });

  it("rate limited → error, no default", async () => {
    const r = await runEnclosure({ call: async () => ({ ok: false, error: "rate_limited", problems: [] }), ...base });
    expect(r).toMatchObject({ ok: false, error: "rate_limited" });
  });
});

describe("safeBbox", () => {
  it("fills and clamps", () => {
    expect(safeBbox({ w: 5000, d: -1 })).toEqual({ w: 400, d: 10, h: 25 });
    expect(safeBbox(null)).toEqual({ w: 60, d: 40, h: 25 });
  });
});
