import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SPEC, type ProductSpec } from "../schema";
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

  it("caps at 12 parts and cuts labels / reasons", () => {
    const comps = Array.from({ length: 20 }, () => ({ partId: "led_5mm", label: "L".repeat(50) }));
    const p = enforcePick({ components: [{ partId: "esp32_devkit" }, ...comps], reasons: { led_5mm: "R".repeat(300) } }, opts());
    expect(p.components).toHaveLength(12);
    expect(p.components[0].partId).toBe("esp32_devkit");
    expect(p.components[1].label.length).toBe(30);
    expect(p.reasons.led_5mm.length).toBe(100);
    expect(new Set(p.components.map((c) => c.instanceId)).size).toBe(12);
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
