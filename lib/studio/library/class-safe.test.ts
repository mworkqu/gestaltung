import { describe, expect, it } from "vitest";

import { LIBRARY } from "./index";
import {
  CLASS_MAX_MA,
  CLASS_MAX_V,
  CLASS_SAFE_SUPPLY_IDS,
  classSafeIds,
  classSafeParts,
  classSafetyReason,
  isClassSafePart,
  isPowerSource,
  unsafeIdsAmong,
} from "./class-safe";

const byId = (id: string) => {
  const part = LIBRARY.find((p) => p.id === id);
  if (!part) throw new Error(`library part ${id} is gone — update this test`);
  return part;
};

describe("class safety mode", () => {
  // Pinned so a new or edited library part cannot quietly become class-safe.
  it("refuses exactly the parts a 12-year-old must not wire up", () => {
    const refused = LIBRARY.filter((p) => !isClassSafePart(p))
      .map((p) => p.id)
      .sort();
    expect(refused).toEqual([
      "arduino_nano", // needs 7–12 V on VIN
      "boost_5v",
      "buck_converter",
      "cell_18650",
      "lipo_1000",
      "mg996r_servo", // 2.5 A stall
      "psu_5v_5a", // mains barrel adapter
      "relay_module", // switches mains
      "tp4056_usbc", // lithium charger
    ]);
  });

  it("keeps the parts a class actually needs", () => {
    for (const id of [
      "arduino_uno",
      "esp32_devkit",
      "pico_w",
      "sg90_servo",
      "n20_motor",
      "motor_driver",
      "pump_5v",
      "dht22",
      "soil_moisture_cap",
      "hcsr04",
      "pir_hcsr501",
      "oled_096_i2c",
      "button_6mm",
      "led_5mm",
      "resistor_220",
      "ws2812_ring",
    ]) {
      expect(isClassSafePart(byId(id)), id).toBe(true);
    }
  });

  it("allows only a USB supply or an AA holder as the power source", () => {
    const supplies = LIBRARY.filter(isPowerSource).map((p) => p.id);
    expect(supplies).toContain("aa_holder_2");
    expect(supplies).toContain("lipo_1000");
    for (const id of supplies) {
      expect(isClassSafePart(byId(id)), id).toBe(CLASS_SAFE_SUPPLY_IDS.includes(id));
    }
    expect(classSafetyReason(byId("psu_5v_5a"))).toBe("supply_not_allowed");
    expect(classSafetyReason(byId("lipo_1000"))).toBe("supply_not_allowed");
  });

  it("names why each refused part is refused", () => {
    expect(classSafetyReason(byId("arduino_nano"))).toBe("needs_more_than_5v");
    expect(classSafetyReason(byId("mg996r_servo"))).toBe("too_much_current");
    expect(classSafetyReason(byId("relay_module"))).toBe("denied");
    expect(classSafetyReason(byId("tp4056_usbc"))).toBe("supply_not_allowed");
    expect(classSafetyReason(byId("arduino_uno"))).toBe(null);
  });

  it("reads vMin, not vMax, so a 5 V-tolerant part is allowed", () => {
    const dht = byId("dht22");
    expect(dht.power.vMax).toBeGreaterThan(CLASS_MAX_V);
    expect(dht.power.vMin).toBeLessThanOrEqual(CLASS_MAX_V);
    expect(isClassSafePart(dht)).toBe(true);
  });

  it("refuses a part that is only tagged unsafe", () => {
    const tagged = { ...byId("button_6mm"), id: "mains_thing", tags: ["switch", "230v"] };
    expect(classSafetyReason(tagged)).toBe("unsafe_tag");
  });

  it("refuses a part over the current limit even with a safe voltage", () => {
    const hungry = {
      ...byId("pump_5v"),
      id: "big_pump",
      power: { ...byId("pump_5v").power, mA: CLASS_MAX_MA + 1 },
    };
    expect(classSafetyReason(hungry)).toBe("too_much_current");
  });

  it("filters a list and names the ids a class may not use", () => {
    const safe = classSafeIds(LIBRARY);
    expect(safe.has("arduino_uno")).toBe(true);
    expect(safe.has("relay_module")).toBe(false);
    expect(unsafeIdsAmong(["arduino_uno", "relay_module", "lipo_1000", "arduino_uno"], safe)).toEqual([
      "relay_module",
      "lipo_1000",
    ]);
    expect(classSafeParts(LIBRARY).length).toBe(LIBRARY.length - 9);
    expect(classSafeParts(LIBRARY).map((p) => p.id)).not.toContain("psu_5v_5a");
  });

  it("leaves at least one board, one sensor and one supply, so a class can build something", () => {
    const safe = classSafeParts(LIBRARY);
    expect(safe.some((p) => p.category === "mcu")).toBe(true);
    expect(safe.some((p) => p.category === "sensor")).toBe(true);
    expect(safe.some((p) => isPowerSource(p))).toBe(true);
  });
});
