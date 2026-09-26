import { describe, expect, it } from "vitest";

import { BUILD_CONSUMABLES, deriveElectronics } from "./electronics-rules";
import { plantLines, plantNetlist, tKey } from "./plant-monitor.fixture";

// Audit #29: one build route's consumables, never both.
const consumables = (route: "prototype" | "custom_pcb") =>
  deriveElectronics({ netlist: plantNetlist(), lines: plantLines, route, power: null, t: tKey })
    .lines.filter((l) => l.class === "consumable")
    .map((l) => l.id)
    .sort();

describe("build consumables by route", () => {
  it("Prototype: a breadboard build only", () => {
    expect(consumables("prototype")).toEqual(["rule_breadboard", "rule_jumpers"]);
  });

  it("Custom PCB: the soldered prototype only — no breadboard", () => {
    expect(consumables("custom_pcb")).toEqual(["rule_heat_shrink", "rule_hookup_wire", "rule_perfboard"]);
  });

  it("the two routes share no consumable", () => {
    const a = new Set(BUILD_CONSUMABLES.prototype.map(([id]) => id));
    expect(BUILD_CONSUMABLES.custom_pcb.some(([id]) => a.has(id))).toBe(false);
  });

  it("a USB cable per board on either route, listed once", () => {
    for (const route of ["prototype", "custom_pcb"] as const) {
      const r = deriveElectronics({ netlist: plantNetlist(), lines: plantLines, route, power: null, t: tKey });
      expect(r.lines.filter((l) => l.id === "rule_usb_cable")).toHaveLength(1);
    }
  });
});
