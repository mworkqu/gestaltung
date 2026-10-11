import { describe, expect, it } from "vitest";

import { DEFAULT_SPEC, type ClampLog, type ProductSpec } from "../schema";
import { enforcePick, type PickIndexEntry } from "./pick";

const INDEX: PickIndexEntry[] = [
  { id: "esp32_devkit", category: "mcu", name: "ESP32 DevKit" },
  { id: "cell_18650", category: "power", name: "18650 cell with holder", tags: ["battery", "18650", "holder"] },
  { id: "lipo_1000", category: "power", name: "LiPo 1000 mAh", tags: ["battery", "lipo", "rechargeable"] },
  { id: "aa_holder_2", category: "power", name: "2 x AA holder", tags: ["battery", "aa", "alkaline", "holder"] },
  { id: "tp4056_usbc", category: "power", name: "USB-C charger", tags: ["charger", "battery", "tp4056"] },
  { id: "usbc_power_5v", category: "power", name: "USB-C power", tags: ["usb-c", "power", "supply"] },
  { id: "boost_5v", category: "power", name: "Boost", tags: ["boost", "converter", "battery-powered"] },
  { id: "soil_moisture_cap", category: "sensor", name: "Soil moisture" },
  { id: "led_5mm", category: "output", name: "LED" },
];

// The plant-monitor fixture: battery product, soil sensor + green light.
const plant: ProductSpec = {
  ...DEFAULT_SPEC,
  name: "Plant monitor",
  oneLine: "Tells me when the plants need water",
  power: "battery",
  features: ["soil sensor", "green light"],
};

const run = (components: string[], spec: ProductSpec = plant, log: ClampLog = []) =>
  enforcePick({ components: components.map((partId) => ({ partId })) }, { spec, index: INDEX, locale: "en", log });
const ids = (p: ReturnType<typeof run>) => p.components.map((c) => c.partId);
const BATTERIES = ["cell_18650", "lipo_1000", "aa_holder_2"];
const batteries = (p: ReturnType<typeof run>) => ids(p).filter((i) => BATTERIES.includes(i));

describe("single power source", () => {
  it("plant monitor: 18650 (with holder) AND LiPo → one battery, the spec's 18650; the charger stays once", () => {
    const p = run(["esp32_devkit", "soil_moisture_cap", "led_5mm", "cell_18650", "lipo_1000", "tp4056_usbc"]);
    expect(batteries(p)).toEqual(["cell_18650"]);
    expect(ids(p).filter((i) => i === "tp4056_usbc")).toHaveLength(1);
    expect(new Set(p.components.map((c) => c.instanceId)).size).toBe(p.components.length);
  });

  it("same result whichever battery the model lists first (deterministic)", () => {
    expect(batteries(run(["esp32_devkit", "lipo_1000", "cell_18650"]))).toEqual(["cell_18650"]);
    expect(batteries(run(["esp32_devkit", "cell_18650", "lipo_1000"]))).toEqual(["cell_18650"]);
  });

  it("keeps a lone LiPo the model chose instead of adding the default cell too", () => {
    const p = run(["esp32_devkit", "lipo_1000"]);
    expect(batteries(p)).toEqual(["lipo_1000"]);
    expect(ids(p)).toContain("tp4056_usbc");
  });

  it("logs each removal", () => {
    const log: ClampLog = [];
    run(["esp32_devkit", "lipo_1000", "cell_18650"], plant, log);
    expect(JSON.stringify(log)).toContain("duplicate_battery");
  });

  it("an explicit backup request keeps both batteries", () => {
    const p = run(["esp32_devkit", "cell_18650", "lipo_1000"], { ...plant, features: ["soil sensor", "backup battery"] });
    expect(batteries(p).sort()).toEqual(["cell_18650", "lipo_1000"]);
  });

  it("battery spec drops a wall supply board; usb spec drops the battery and its charger", () => {
    expect(ids(run(["esp32_devkit", "usbc_power_5v", "cell_18650"]))).not.toContain("usbc_power_5v");
    const usb = run(["esp32_devkit", "usbc_power_5v", "cell_18650", "tp4056_usbc"], { ...DEFAULT_SPEC, power: "usb" });
    expect(ids(usb)).toContain("usbc_power_5v");
    expect(batteries(usb)).toEqual([]);
    expect(ids(usb)).not.toContain("tp4056_usbc");
  });

  it("a Li-ion charger does not stay next to an alkaline holder", () => {
    const p = run(["esp32_devkit", "aa_holder_2", "tp4056_usbc"], { ...DEFAULT_SPEC, power: "mains_adapter" });
    expect(ids(p)).not.toContain("tp4056_usbc");
  });

  it("a boost converter is not a battery", () => {
    expect(ids(run(["esp32_devkit", "cell_18650", "boost_5v"]))).toContain("boost_5v");
  });
});
