import { describe, expect, it } from "vitest";
import { drawing2d, PITCH_MM } from "./drawing2d";
import { LIBRARY, getPart } from "./library";

const CHECK = [
  "arduino_uno", "esp32_devkit", "esp32_c3_mini", "soil_moisture_cap", "pump_5v", "motor_driver", "relay_module",
  "led_5mm", "resistor_220", "ws2812_ring", "sg90_servo", "button_6mm", "usbc_power_5v", "oled_096_i2c", "dht22",
];

describe("drawing2d", () => {
  it("gives distinct pin positions for every library part", () => {
    for (const p of LIBRARY) {
      const d = drawing2d(p);
      expect(d.pins.length, p.id).toBe(p.pins.length);
      const keys = new Set(d.pins.map((x) => `${x.x}:${x.y}`));
      expect(keys.size, p.id).toBe(d.pins.length);
      for (const pin of d.pins) {
        expect(pin.y, p.id).toBeGreaterThan(0);
        expect(pin.y, p.id).toBeLessThan(d.h);
        expect(pin.x === 0 || pin.x === d.w, p.id).toBe(true);
      }
    }
  });

  it("puts the pins of one edge 2.54 mm apart", () => {
    for (const p of LIBRARY) {
      const d = drawing2d(p);
      for (const edge of ["left", "right"] as const) {
        const ys = d.pins.filter((x) => x.edge === edge).map((x) => x.y).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], p.id).toBeCloseTo(PITCH_MM, 1);
      }
    }
  });

  it("checks the key boards and modules", () => {
    for (const id of CHECK) {
      const d = drawing2d(getPart(id)!);
      expect(d.w, id).toBeGreaterThan(0);
      expect(d.h, id).toBeGreaterThan(0);
    }
    // ESP32 DevKit: a vertical header on each long side, turned 90 degrees.
    const esp = drawing2d(getPart("esp32_devkit")!);
    expect(esp.h).toBeGreaterThan(esp.w);
    expect(esp.pins.filter((p) => p.edge === "left")).toHaveLength(15);
    expect(esp.pins.filter((p) => p.edge === "right")).toHaveLength(15);
    // Uno: top / bottom headers become the two vertical rows.
    const uno = drawing2d(getPart("arduino_uno")!);
    expect(uno.pins.filter((p) => p.edge === "left")).toHaveLength(15);
    expect(uno.pins.filter((p) => p.edge === "right")).toHaveLength(11);
    // Small parts keep their pins on one edge.
    for (const id of ["soil_moisture_cap", "pump_5v", "led_5mm", "dht22", "oled_096_i2c", "sg90_servo"]) {
      expect(new Set(drawing2d(getPart(id)!).pins.map((p) => p.edge)).size, id).toBe(1);
    }
    // The resistor stays two-ended.
    expect(new Set(drawing2d(getPart("resistor_220")!).pins.map((p) => p.edge)).size).toBe(2);
    expect(drawing2d(getPart("resistor_220")!).decor).toBe("resistor");
    expect(drawing2d(getPart("led_5mm")!).decor).toBe("led");
    expect(drawing2d(getPart("oled_096_i2c")!).decor).toBe("screen");
    expect(drawing2d(getPart("ws2812_ring")!).decor).toBe("ring");
  });

  it("honours an explicit drawing2d override", () => {
    const p = { ...getPart("led_5mm")!, drawing2d: { colour: "#123456", edges: { A: "left" as const } } };
    const d = drawing2d(p);
    expect(d.colour).toBe("#123456");
    expect(d.pins.find((x) => x.id === "A")!.edge).toBe("left");
  });
});
