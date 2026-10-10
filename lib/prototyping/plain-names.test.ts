import { describe, expect, it } from "vitest";

import { plantNetlist } from "./plant-monitor.fixture";
import {
  plainComponentLabels,
  plainKindOf,
  plainNetLabels,
  plainPartName,
  plainPinLabel,
  type PlainWords,
} from "./plain-names";

const words: PlainWords = { power: "Power", ground: "Ground", signal: "Signal", connection: "Connection" };

describe("plainPartName (client wiring labels)", () => {
  it("reads the part's human name, in English", () => {
    expect(plainPartName("PIR motion sensor")).toBe("Motion sensor");
    expect(plainPartName("Relay module for the lamp")).toBe("Lamp relay");
    expect(plainPartName("5 V relay module")).toBe("Relay");
    expect(plainPartName("5V USB power adapter")).toBe("Power adapter");
    expect(plainPartName("ESP32 development board")).toBe("Main board");
    expect(plainPartName("soil moisture sensor")).toBe("Soil moisture sensor");
    expect(plainPartName("DHT11 sensor")).toBe("Temperature sensor");
    expect(plainPartName("status LED")).toBe("Status light");
    expect(plainPartName("water pump")).toBe("Water pump");
    expect(plainPartName("logic level shifter")).toBe("Voltage adapter");
    expect(plainPartName("light sensor (LDR)")).toBe("Light sensor");
  });

  it("is natural Arabic with no Latin designators", () => {
    expect(plainPartName("PIR motion sensor", "ar")).toBe("مستشعر الحركة");
    expect(plainPartName("relay for the lamp", "ar")).toBe("مرحّل المصباح");
    expect(plainPartName("USB power adapter", "ar")).toBe("محوّل الطاقة");
  });

  it("never returns a designator or an id", () => {
    expect(plainPartName("U1")).toBe("Part");
    expect(plainPartName("R_LED1")).toBe("Part");
    expect(plainPartName("")).toBe("Part");
    expect(plainPartName(null)).toBe("Part");
    expect(plainPartName("monitor_firmware")).toBe("Monitor firmware");
  });

  it("falls back to the first words of an unknown name, without spec numbers", () => {
    expect(plainPartName("USB connector, 5 V, 2 A, Type C")).toBe("USB connector V");
    expect(plainPartName("Heat shrink tubing")).toBe("Heat shrink tubing");
  });

  it("does not take a light sensor for a light", () => {
    expect(plainKindOf("ambient light sensor")).toBe("lightSensor");
    expect(plainKindOf("LED strip")).toBe("lightStrip");
    expect(plainKindOf("lamp")).toBe("light");
  });
});

describe("plainComponentLabels / plainNetLabels / plainPinLabel", () => {
  it("numbers parts that read the same", () => {
    const m = plainComponentLabels([
      { ref: "LED1", function: "status LED" },
      { ref: "LED2", function: "status LED" },
      { ref: "U1", function: "ESP32 development board" },
    ]);
    expect(m.get("LED1")).toBe("Status light");
    expect(m.get("LED2")).toBe("Status light 2");
    expect(m.get("U1")).toBe("Main board");
  });

  it("names pins by what they are, never GPIO23 or VIN", () => {
    expect(plainPinLabel("power_in", words)).toBe("Power");
    expect(plainPinLabel("power_out", words)).toBe("Power");
    expect(plainPinLabel("ground", words)).toBe("Ground");
    expect(plainPinLabel("bidirectional", words)).toBe("Signal");
    expect(plainPinLabel("output", words)).toBe("Signal");
    expect(plainPinLabel("passive", words)).toBe("Connection");
  });

  it("names the wires: supply wires plainly, a signal wire for its far part, nothing technical", () => {
    const n = plantNetlist();
    const names = plainComponentLabels(n.components);
    const nets = plainNetLabels(n, names, words);
    expect([...nets.keys()].length).toBe(n.nets.length);
    for (const label of nets.values()) {
      expect(label).not.toMatch(/GPIO|IO\d|VIN|SIG\b|^U\d/);
    }
    expect([...nets.values()].some((l) => l === "Ground")).toBe(true);
    expect([...nets.values()].some((l) => l.startsWith("Signal · "))).toBe(true);
  });
});
