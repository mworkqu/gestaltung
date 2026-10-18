import { describe, expect, it } from "vitest";

import { cardCoverage, cardItems } from "./card-parts";
import { enforcePick } from "./ai/pick";
import { buildWiring } from "./netlist";
import { getPart, libraryIndexForAI } from "./library";
import { clampSpec, type ProductSpec } from "./schema";

// The owner's live test (2026-10-18): "Smart Plant Monitor" with 3 LEDs added in the chat.
const plant: ProductSpec = clampSpec({
  name: "Smart Plant Monitor",
  oneLine: "Waters the plant and shows its state with lights.",
  use: "desk",
  power: "usb",
  outputs: ["led", "pump"],
  inputs: [],
  placement: "plant_soil",
  features: ["soil moisture"],
  understanding: {
    goal: "Keep the plant watered",
    howItWorks: "The soil sensor reads moisture; the board runs the pump and sets the lights.",
    controller: "Arduino Uno",
    sensors: [{ name: "Soil moisture sensor", count: 1 }],
    actuators: [{ name: "5V water pump", count: 1, kind: "pump" }],
    outputs: [{ name: "Green, yellow, and red LEDs", count: 3 }],
  },
});

const pick = (spec: ProductSpec, raw: unknown) =>
  enforcePick(raw, {
    spec,
    index: libraryIndexForAI(),
    locale: "en",
    log: [],
    nameFor: (id, l) => getPart(id)?.name[l],
    lookup: (id) => { const p = getPart(id); return p ? { id: p.id, category: p.category, tags: p.tags } : undefined; },
  });

describe("card items ⊆ parts", () => {
  it("reads the card: 3 LEDs, the soil sensor, the pump", () => {
    const items = Object.fromEntries(cardItems(plant).map((i) => [i.key, i.count]));
    expect(items).toMatchObject({ led: 3, soil: 1, pump: 1 });
  });

  it("a model pick without the LEDs still gets all 3, each with its resistor, and a MOSFET for the pump", () => {
    const picked = pick(plant, { components: [{ partId: "arduino_uno" }, { partId: "soil_moisture_cap" }, { partId: "pump_5v" }, { partId: "motor_driver" }] });
    expect(cardCoverage(plant, picked.components)).toEqual([]);
    const wired = buildWiring(picked.components, plant, getPart, "en").components;
    const count = (id: string) => wired.filter((c) => c.partId === id).length;
    expect(count("led_5mm")).toBe(3);
    expect(count("resistor_220")).toBe(3);
    expect(count("mosfet_module")).toBe(1);
    expect(count("motor_driver")).toBe(0);
    expect(cardCoverage(plant, wired)).toEqual([]);
  });

  it("an empty answer (the safe default) still covers the card", () => {
    expect(cardCoverage(plant, pick(plant, {}).components)).toEqual([]);
  });

  it("a DC motor that may reverse keeps the H-bridge", () => {
    const car = clampSpec({ name: "Robot car", oneLine: "Drives around", outputs: ["motor"], actuators: [{ kind: "motor", count: 2, load: "light" }] });
    const wired = buildWiring(pick(car, { components: [{ partId: "esp32_devkit" }] }).components, car, getPart, "en").components;
    expect(wired.some((c) => c.partId === "motor_driver")).toBe(true);
  });
});

describe("LED colours from the card", () => {
  it("green, yellow and red LEDs × 3 → one of each, each its own store listing", async () => {
    const { skusFor, VARIANT_SKUS } = await import("./variants");
    const picked = pick(plant, { components: [{ partId: "arduino_uno" }] });
    const leds = picked.components.filter((c) => c.partId === "led_5mm");
    expect(leds.map((c) => c.variant)).toEqual(["green", "yellow", "red"]);
    expect(skusFor(getPart("led_5mm"), "green")[0]).toBe(VARIANT_SKUS.led_5mm.green);
    // The wiring keeps the colours.
    const wired = buildWiring(picked.components, plant, getPart, "en").components;
    expect(wired.filter((c) => c.partId === "led_5mm").map((c) => c.variant)).toEqual(["green", "yellow", "red"]);
  });
});

describe("the card decides the sensors and outputs", () => {
  it("drops an LED ring the card never mentions, keeps the board, pump and power", () => {
    const picked = pick(plant, {
      components: [{ partId: "arduino_uno" }, { partId: "ws2812_ring" }, { partId: "pump_5v" }, { partId: "usbc_power_5v" }],
    });
    const ids = picked.components.map((c) => c.partId);
    expect(ids).not.toContain("ws2812_ring");
    expect(ids).toEqual(expect.arrayContaining(["arduino_uno", "pump_5v", "usbc_power_5v", "led_5mm", "soil_moisture_cap"]));
  });
});
