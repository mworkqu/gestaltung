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

/** The owner's live card, after "i dont need any microcontroller i need actual ics". */
const demorgan: ProductSpec = {
  ...clampSpec({
    name: "De Morgan logic kit",
    oneLine: "Shows De Morgan's law with real gate chips on a breadboard.",
    outputs: ["led"],
    inputs: [],
    features: ["7400-series gates", "truth table"],
    understanding: {
      goal: "Prove De Morgan's law by hand",
      howItWorks: "Two switches feed the gate chips; the LEDs show each gate's output.",
      controller: "",
      sensors: [{ name: "Toggle Switches", count: 2 }],
      actuators: [],
      outputs: [
        { name: "AND gate (7408)", count: 1 },
        { name: "OR gate (7432)", count: 1 },
        { name: "NOT gate (7404)", count: 1 },
        { name: "LEDs", count: 2 },
      ],
    },
  }),
  // Set by hand: clampSpec() in schema.ts does not carry the field through yet. The
  // inference net in build-class.ts reads these same words, so the picker would get
  // "logic" even without it.
  buildClass: "logic",
};

// ── The two holes in the coverage check (2026-10-20) ────────────────────────
//
// 1. understanding.controller was never mapped to a part, so the "card ⊆ parts"
//    guarantee had a hole exactly at the brain of the build.
// 2. SENSOR_RULES had a `button` rule but no switch/toggle rule, so "Toggle Switches ×2"
//    matched nothing, was silently left out of the check, and the user got one push button.

describe("the card's controller is checked too", () => {
  it("a card that promises a controller and parts without one → missing", () => {
    const missing = cardCoverage(plant, [{ partId: "soil_moisture_cap" }, { partId: "pump_5v" }, { partId: "led_5mm" }, { partId: "led_5mm" }, { partId: "led_5mm" }]);
    expect(missing).toEqual([{ key: "controller", want: 1, have: 0 }]);
  });

  it("any board satisfies it: the card says Uno, the picker chose the C3", () => {
    const parts = [{ partId: "esp32_c3_mini" }, { partId: "soil_moisture_cap" }, { partId: "pump_5v" }, ...Array(3).fill({ partId: "led_5mm" })];
    expect(cardCoverage(plant, parts)).toEqual([]);
  });

  it("a logic build's controller promise is the gate chips, never a board", () => {
    const items = Object.fromEntries(cardItems(demorgan).map((i) => [i.key, i]));
    expect(items.controller.ids).toContain("ic_7408");
    expect(items.controller.ids).not.toContain("esp32_devkit");
    // A gate chip covers it; an ESP32 does not.
    expect(cardCoverage(demorgan, [{ partId: "ic_7408" }]).map((m) => m.key)).not.toContain("controller");
    expect(cardCoverage(demorgan, [{ partId: "esp32_devkit" }]).map((m) => m.key)).toContain("controller");
  });

  it("a card with no controller line promises none (the board is never dropped)", () => {
    const noBrain = clampSpec({
      ...plant,
      understanding: { ...plant.understanding!, controller: "" },
    }) as ProductSpec;
    expect(cardItems(noBrain).map((i) => i.key)).not.toContain("controller");
    const picked = pick(noBrain, { components: [{ partId: "arduino_uno" }] });
    expect(picked.components.map((c) => c.partId)).toContain("arduino_uno");
  });
});

describe("switches and gate chips on the card", () => {
  it('"Toggle Switches ×2" → 2 switch parts, and the gates map to their chips', () => {
    const items = Object.fromEntries(cardItems(demorgan).map((i) => [i.key, i.count]));
    expect(items).toMatchObject({ switch: 2, gate_and: 1, gate_or: 1, gate_not: 1, led: 2 });
    const picked = pick(demorgan, { components: [{ partId: "ic_7408" }] });
    const ids = picked.components.map((c) => c.partId);
    expect(ids.filter((id) => id === "slide_switch" || id === "dip_switch_4")).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining(["ic_7408", "ic_7432", "ic_7404", "breadboard_830", "jumper_kit"]));
    expect(ids).not.toContain("esp32_devkit");
    expect(cardCoverage(demorgan, picked.components)).toEqual([]);
  });

  it("a push button is still a button, not a switch (rule order)", () => {
    const keys = (name: string) =>
      cardItems(clampSpec({
        name: "Button test",
        oneLine: "x",
        understanding: {
          goal: "g", howItWorks: "h", controller: "Arduino Uno",
          sensors: [{ name, count: 1 }], actuators: [], outputs: [],
        },
      })).map((i) => i.key);
    expect(keys("Push button")).toContain("button");
    expect(keys("Push button switch")).toContain("button");
    expect(keys("Push button switch")).not.toContain("switch");
    expect(keys("Toggle switch")).toContain("switch");
    expect(keys("4-way DIP switch")).toContain("dip_switch");
  });

  it("an LED that merely mentions a gate stays an LED", () => {
    const keys = cardItems(clampSpec({
      name: "Gate watcher",
      oneLine: "x",
      understanding: {
        goal: "g", howItWorks: "h", controller: "",
        sensors: [], actuators: [],
        outputs: [{ name: "LED showing the AND gate output", count: 1 }],
      },
      buildClass: "logic",
    })).map((i) => i.key);
    expect(keys).toContain("led");
    expect(keys).not.toContain("gate_and");
  });
});
