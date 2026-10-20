import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SPEC, type ClampLog, type ProductSpec } from "../schema";
import { fakeModel } from "./fake-model";
import { enforcePick, runPick, type PickIndexEntry } from "./pick";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

const INDEX: PickIndexEntry[] = [
  { id: "esp32_devkit", category: "mcu", name: "ESP32 DevKit" },
  { id: "arduino_uno", category: "mcu", name: "Arduino Uno" },
  { id: "cell_18650", category: "power", name: "18650 cell" },
  { id: "tp4056_usbc", category: "power", name: "USB-C charger" },
  { id: "dht22", category: "sensor", name: "DHT22" },
  { id: "led_5mm", category: "output", name: "LED 5 mm" },
  { id: "button_6mm", category: "input", name: "Button" },
];
const spec = (over: Partial<ProductSpec> = {}): ProductSpec => ({ ...DEFAULT_SPEC, ...over });
const opts = (over: Partial<ProductSpec> = {}) => ({ spec: spec(over), index: INDEX, locale: "en" as const, log: [] });

describe("runPick", () => {
  it("valid answer → components with instance ids and reasons", async () => {
    const m = fakeModel([
      {
        components: [{ partId: "esp32_devkit", label: "Brain" }, { partId: "dht22", label: "Sensor" }],
        reasons: [{ partId: "dht22", reason: "Measures temperature." }],
      },
    ]);
    const r = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("model");
    expect(r.value.components.map((c) => c.instanceId)).toEqual(["esp32_devkit_1", "dht22_1"]);
    expect(r.value.reasons).toEqual({ dht22: "Measures temperature." });
    expect(r.value.components[1].reason).toBe("Measures temperature.");
  });

  it("drops unknown ids (logged, not returned)", async () => {
    const m = fakeModel([{ components: [{ partId: "esp32_devkit", label: "x" }, { partId: "flux_capacitor", label: "y" }] }]);
    const r = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.value.components.map((c) => c.partId)).toEqual(["esp32_devkit"]);
    expect(r.clampLog.some((l) => l.from === "flux_capacitor")).toBe(true);
    expect(JSON.stringify(r.value)).not.toContain("flux_capacitor");
  });

  it("only unknown ids → retry with the problem → valid", async () => {
    const m = fakeModel([{ components: [{ partId: "raspberry_pi", label: "x" }] }, { components: [{ partId: "arduino_uno", label: "Uno" }] }]);
    const r = await runPick({ call: m.call, spec: spec(), index: INDEX, locale: "en" });
    expect(r.ok && r.value.components[0].partId).toBe("arduino_uno");
    expect(m.prompts[1]).toContain("use only part ids from the library list");
  });

  it("exactly one mcu: none → esp32_devkit, several → the first", () => {
    const none = enforcePick({ components: [{ partId: "dht22" }] }, opts());
    expect(none.components.map((c) => c.partId)).toEqual(["esp32_devkit", "dht22"]);
    const many = enforcePick({ components: [{ partId: "dht22" }, { partId: "arduino_uno" }, { partId: "esp32_devkit" }] }, opts());
    expect(many.components.map((c) => c.partId)).toEqual(["arduino_uno", "dht22"]);
  });

  it("adds the battery parts for battery power", () => {
    const p = enforcePick({ components: [{ partId: "esp32_devkit" }] }, opts({ power: "battery" }));
    expect(p.components.map((c) => c.partId)).toEqual(["esp32_devkit", "cell_18650", "tp4056_usbc"]);
  });

  it("identical parts are one slot (at most 8 of one part) and cuts labels / reasons", () => {
    const comps = Array.from({ length: 20 }, () => ({ partId: "led_5mm", label: "L".repeat(50) }));
    const p = enforcePick({ components: [{ partId: "esp32_devkit" }, ...comps], reasons: { led_5mm: "R".repeat(300) } }, opts());
    expect(p.components).toHaveLength(9);
    expect(p.components[0].partId).toBe("esp32_devkit");
    expect(p.components[1].label.length).toBe(30);
    expect(p.reasons.led_5mm.length).toBe(100);
    expect(new Set(p.components.map((c) => c.instanceId)).size).toBe(9);
    expect(p.components.at(-1)?.instanceId).toBe("led_5mm_8");
  });

  it("caps at 12 KINDS of part", () => {
    const many: PickIndexEntry[] = [...INDEX, ...Array.from({ length: 14 }, (_, i) => ({ id: `extra_${i}`, category: "sensor" }))];
    const comps = many.filter((e) => e.category === "sensor").flatMap((e) => [{ partId: e.id }, { partId: e.id }]);
    const p = enforcePick({ components: [{ partId: "esp32_devkit" }, ...comps] }, { ...opts(), index: many });
    expect(new Set(p.components.map((c) => c.partId)).size).toBe(12);
    expect(p.components).toHaveLength(1 + 11 * 2);
  });

  it("invalid twice → minimal default (mcu + power parts) with localized labels", async () => {
    const m = fakeModel(["x", "y"]);
    const r = await runPick({
      call: m.call,
      spec: spec({ power: "battery_usb" }),
      index: INDEX,
      locale: "ar",
      nameFor: (id, l) => (l === "ar" && id === "esp32_devkit" ? "لوحة ESP32" : undefined),
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("default");
    expect(r.value.components.map((c) => c.partId)).toEqual(["esp32_devkit", "cell_18650", "tp4056_usbc"]);
    expect(r.value.components[0].label).toBe("لوحة ESP32");
  });

  it("paused → error, no default", async () => {
    const r = await runPick({ call: async () => ({ ok: false, error: "paused", problems: [] }), spec: spec(), index: INDEX, locale: "en" });
    expect(r).toMatchObject({ ok: false, error: "paused" });
  });
});

// ── Build classes (2026-10-20) ──────────────────────────────────────────────
//
// The bug: a De Morgan kit ("or gate (7432) and gate (7408) and not gate (7404) with wire
// and bread board and switches and led", then "i dont need any microcontroller i need
// actual ics") came back with a NodeMCU ESP32 at the top of the parts list, because
// enforcePick() unshifted esp32_devkit whenever the model returned no mcu at all.

const LOGIC_INDEX: PickIndexEntry[] = [
  ...INDEX,
  { id: "ic_7408", category: "logic", name: "AND gate chip (7408)" },
  { id: "ic_7432", category: "logic", name: "OR gate chip (7432)" },
  { id: "ic_7404", category: "logic", name: "NOT gate chip (7404)" },
  { id: "breadboard_830", category: "connector", name: "Breadboard (830)" },
  { id: "jumper_kit", category: "connector", name: "Jumper wire kit" },
  { id: "dip_switch_4", category: "input", name: "DIP switch (4-way)" },
  { id: "slide_switch", category: "input", name: "Slide switch" },
];

/** The owner's live card: gates, a breadboard, two toggle switches, LEDs, no controller. */
const demorgan = (over: Partial<ProductSpec> = {}): ProductSpec =>
  spec({
    name: "De Morgan logic kit",
    oneLine: "Shows De Morgan's law with real gate chips on a breadboard.",
    buildClass: "logic",
    outputs: ["led"],
    understanding: {
      goal: "Prove De Morgan's law by hand",
      howItWorks: "Two switches feed the gate chips; the LEDs show each gate's output.",
      controller: "",
      sensors: [{ name: "Toggle switches", count: 2 }],
      actuators: [],
      outputs: [
        { name: "AND gate (7408)", count: 1 },
        { name: "OR gate (7432)", count: 1 },
        { name: "NOT gate (7404)", count: 1 },
        { name: "LEDs", count: 2 },
      ],
    },
    ...over,
  });

const logicOpts = (s: ProductSpec) => ({ spec: s, index: LOGIC_INDEX, locale: "en" as const, log: [] as ClampLog });

describe("a logic build has no microcontroller", () => {
  it("zero mcus in the answer stay zero mcus in the list (the actual bug)", () => {
    const p = enforcePick(
      { components: [{ partId: "ic_7432" }, { partId: "ic_7408" }, { partId: "ic_7404" }, { partId: "dip_switch_4" }, { partId: "led_5mm" }] },
      logicOpts(demorgan()),
    );
    const cats = p.components.map((c) => LOGIC_INDEX.find((e) => e.id === c.partId)?.category);
    expect(cats).not.toContain("mcu");
    expect(p.components.map((c) => c.partId)).not.toContain("esp32_devkit");
    expect(p.components.map((c) => c.partId)).toEqual(expect.arrayContaining(["ic_7408", "ic_7432", "ic_7404"]));
  });

  it("the breadboard and the jumpers are added, and the gates lead the list", () => {
    const p = enforcePick({ components: [{ partId: "led_5mm" }, { partId: "ic_7408" }] }, logicOpts(demorgan()));
    const ids = p.components.map((c) => c.partId);
    expect(ids).toEqual(expect.arrayContaining(["breadboard_830", "jumper_kit"]));
    // Leads first, so the 12-kind cap can never drop the gates or the board they sit on.
    expect(ids[0]).toBe("ic_7408");
    expect(ids.indexOf("breadboard_830")).toBeLessThan(ids.indexOf("led_5mm"));
  });

  it("an ESP32 the model slipped in anyway is dropped, and the clamp is logged", () => {
    const log: ClampLog = [];
    const p = enforcePick(
      { components: [{ partId: "esp32_devkit" }, { partId: "ic_7408" }, { partId: "led_5mm" }] },
      { ...logicOpts(demorgan()), log },
    );
    expect(p.components.map((c) => c.partId)).not.toContain("esp32_devkit");
    expect(log).toEqual(expect.arrayContaining([{ path: "components.mcu", from: ["esp32_devkit"], to: null }]));
  });

  it("ids the library does not have yet are simply not added", () => {
    // INDEX has no gate chips, no breadboard: the picker must not invent them or crash.
    const p = enforcePick({ components: [{ partId: "led_5mm" }] }, { spec: demorgan(), index: INDEX, locale: "en", log: [] });
    expect(p.components.map((c) => c.partId)).not.toContain("esp32_devkit");
    expect(p.components.map((c) => c.partId)).toContain("led_5mm");
  });

  it("the two-failures fallback is a logic kit, not a board", async () => {
    const m = fakeModel(["x", "y"]);
    const r = await runPick({ call: m.call, spec: demorgan(), index: LOGIC_INDEX, locale: "en" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.source).toBe("default");
    const ids = r.value.components.map((c) => c.partId);
    expect(ids).not.toContain("esp32_devkit");
    expect(ids).toEqual(expect.arrayContaining(["breadboard_830", "jumper_kit"]));
  });

  it("a cad build gets no microcontroller either", () => {
    const p = enforcePick({ components: [{ partId: "esp32_devkit" }] }, logicOpts(spec({ buildClass: "cad" })));
    expect(p.components.map((c) => c.partId)).not.toContain("esp32_devkit");
  });
});

describe("mcu builds are untouched by the build class", () => {
  it("no buildClass at all still behaves as an mcu build: zero mcus → esp32_devkit", () => {
    const s = spec();
    expect(s.buildClass).toBeUndefined();
    const p = enforcePick({ components: [{ partId: "dht22" }] }, { spec: s, index: LOGIC_INDEX, locale: "en", log: [] });
    expect(p.components.map((c) => c.partId)).toEqual(["esp32_devkit", "dht22"]);
  });

  it('buildClass "mcu" set explicitly behaves exactly the same', () => {
    const none = enforcePick({ components: [{ partId: "dht22" }] }, opts({ buildClass: "mcu" }));
    expect(none.components.map((c) => c.partId)).toEqual(["esp32_devkit", "dht22"]);
    const many = enforcePick(
      { components: [{ partId: "dht22" }, { partId: "arduino_uno" }, { partId: "esp32_devkit" }] },
      opts({ buildClass: "mcu" }),
    );
    expect(many.components.map((c) => c.partId)).toEqual(["arduino_uno", "dht22"]);
  });

  it("the mcu still leads, and the battery parts still follow it", () => {
    const p = enforcePick({ components: [{ partId: "dht22" }, { partId: "esp32_devkit" }] }, opts({ power: "battery" }));
    expect(p.components.map((c) => c.partId)).toEqual(["esp32_devkit", "cell_18650", "tp4056_usbc", "dht22"]);
  });

  it("a gate chip the card never named is off-card on an mcu build", () => {
    const sensing = spec({
      understanding: {
        goal: "Watch the room",
        howItWorks: "The board reads the sensor and lights the LED.",
        controller: "Arduino Uno",
        sensors: [{ name: "DHT22 temperature sensor", count: 1 }],
        actuators: [],
        outputs: [{ name: "LED", count: 1 }],
      },
    });
    const p = enforcePick(
      { components: [{ partId: "arduino_uno" }, { partId: "dht22" }, { partId: "ic_7408" }] },
      { spec: sensing, index: LOGIC_INDEX, locale: "en", log: [] },
    );
    expect(p.components.map((c) => c.partId)).not.toContain("ic_7408");
    expect(p.components.map((c) => c.partId)).toEqual(expect.arrayContaining(["arduino_uno", "dht22", "led_5mm"]));
  });
});
