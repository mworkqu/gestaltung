// F-007 / F-052: the pump of the QA tester's plant waterer was wired "MOSFET OUT → Pump +"
// and "Pump − → board GND", which leaves the MOSFET switching nothing. These tests pin the
// two-terminal load path and the hard rule that refuses the old wiring.

import { describe, expect, it } from "vitest";
import { hardRules } from "@/lib/prototyping/netlist";
import { getPart } from "./library";
import { buildWiring, toLegacyNetlist } from "./netlist";
import { PLANT_WATERER, PLANT_WATERER_BROKEN_NETS } from "./__fixtures__/plant-waterer";
import type { Net } from "./schema";

const netOf = (nets: Net[], ref: string) => nets.find((n) => n.pins.includes(ref));

describe("low-side switch module (plant waterer)", () => {
  const w = buildWiring(PLANT_WATERER.components, PLANT_WATERER.spec, getPart, "en");

  it("puts the pump between the load rail and the switched terminal", () => {
    const plus = netOf(w.netlist.nets, "pump_5v_1.M_PLUS")!;
    const minus = netOf(w.netlist.nets, "pump_5v_1.M_MINUS")!;
    // The + end shares the rail that feeds the module's own load-power pin…
    expect(plus.pins).toContain("mosfet_module_1.VIN");
    // …and the return is the module's switched terminal, on its own net.
    expect(minus.pins).toEqual(["mosfet_module_1.OUT", "pump_5v_1.M_MINUS"]);
    expect(minus.name).not.toBe("GND");
    expect(netOf(w.netlist.nets, "pump_5v_1.M_MINUS")?.name).not.toBe("GND");
  });

  it("passes the new hard rule", () => {
    expect(hardRules(w.legacy).filter((f) => f.code === "load_return_on_ground")).toEqual([]);
  });

  it("fails the new hard rule on the wiring the tester got", () => {
    const broken = toLegacyNetlist(PLANT_WATERER.components, PLANT_WATERER_BROKEN_NETS, getPart);
    const flags = hardRules(broken).filter((f) => f.code === "load_return_on_ground");
    expect(flags).toEqual([{ code: "load_return_on_ground", ref: "pump_5v_1", driver: "mosfet_module_1", net: "GND" }]);
  });

  it("says in plain words that the load would run all the time", () => {
    const broken = toLegacyNetlist(PLANT_WATERER.components, PLANT_WATERER_BROKEN_NETS, getPart);
    expect(hardRules(broken).some((f) => f.code === "load_return_on_ground")).toBe(true);
    // The Studio line for the same circuit (studioChecks runs the same rules).
    const checks = buildWiring(PLANT_WATERER.components, PLANT_WATERER.spec, getPart, "en").checks;
    expect(checks.some((c) => c.id.startsWith("load_return_on_ground"))).toBe(false);
  });

  it("cautions about USB while a power board feeds the 5 V pin (F-052)", () => {
    const battery = buildWiring(
      [
        { partId: "esp32_c3_mini", instanceId: "esp32_c3_mini_1", label: "Board" },
        { partId: "cell_18650", instanceId: "cell_18650_1", label: "Battery" },
        { partId: "tp4056_usbc", instanceId: "tp4056_usbc_1", label: "Charger" },
      ],
      { ...PLANT_WATERER.spec, power: "battery_usb" },
      getPart,
      "en",
    );
    const line = battery.checks.find((c) => c.id === "usb_backfeed");
    expect(line?.plain).toBe("Unplug USB while the power board feeds the 5 V pin.");
    // A plain USB build is fed through its own socket: no caution.
    const usb = buildWiring(PLANT_WATERER.components, PLANT_WATERER.spec, getPart, "en");
    expect(usb.checks.some((c) => c.id === "usb_backfeed")).toBe(false);
  });

  it("has the caution in Arabic too", () => {
    const ar = buildWiring(
      [
        { partId: "esp32_c3_mini", instanceId: "esp32_c3_mini_1", label: "Board" },
        { partId: "cell_18650", instanceId: "cell_18650_1", label: "Battery" },
        { partId: "tp4056_usbc", instanceId: "tp4056_usbc_1", label: "Charger" },
      ],
      { ...PLANT_WATERER.spec, power: "battery_usb" },
      getPart,
      "ar",
    );
    expect(ar.checks.find((c) => c.id === "usb_backfeed")?.plain).toMatch(/[؀-ۿ]/);
  });
});
