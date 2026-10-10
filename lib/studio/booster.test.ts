import { describe, expect, it } from "vitest";
import { getPart } from "./library";
import { buildWiring } from "./netlist";
import { clampSpec } from "./schema";

const comp = (partId: string, n = 1) => ({ partId, instanceId: `${partId}_${n}`, label: partId });

describe("5 V booster on battery builds", () => {
  const spec = clampSpec({ name: "Motion lamp", use: "desk", power: "battery_usb" });

  it("adds boost_5v when a part needs more than the battery gives, and powers it", () => {
    const w = buildWiring(
      [comp("esp32_devkit"), comp("cell_18650"), comp("tp4056_usbc"), comp("pir_hcsr501")],
      spec, getPart, "en",
    );
    expect(w.components.some((c) => c.partId === "boost_5v" && c.auto)).toBe(true);
    const pirSupplyPowered = w.netlist.nets.some(
      (n) => n.pins.some((p) => p.startsWith("pir_hcsr501_1.")) && n.name !== "GND" && n.pins.length > 1
        && n.pins.some((p) => p.startsWith("boost_5v_1.")),
    );
    expect(pirSupplyPowered).toBe(true);
    expect(w.unconnected.filter((u) => u.startsWith("pir_hcsr501_1."))).toEqual([]);
  });

  it("does not add it on USB power", () => {
    const w = buildWiring([comp("esp32_devkit"), comp("pir_hcsr501")], clampSpec({ name: "Motion lamp", power: "usb" }), getPart, "en");
    expect(w.components.some((c) => c.partId === "boost_5v")).toBe(false);
  });
});
