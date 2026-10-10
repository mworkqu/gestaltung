import { describe, expect, it } from "vitest";

import { classOf, deriveAttributes, effectiveAttributes, headNoun, lineAttributes, nearestE12, parseOhms, parsePack } from "./derive-attributes";

const d = (name: string) => deriveAttributes({ name }).attributes;

describe("deriveAttributes — class from the head noun", () => {
  it.each([
    ["Limit Switch Module – Mechanical Collision Detection Sensor", "switch"],
    ["IR Line Tracking Sensor Module – Adjustable Sensitivity", "sensor"],
    ["HC-SR501 PIR Motion Sensor - Digital Output", "sensor"],
    ["12V Pre-Wired LED – 3mm/5mm with Built-in Resistor", "led"],
    ["1 Channel Relay Module", "module"],
    ["L298N Motor Driver Module", "module"],
    ["Logic Level Converter - Bi-Directional", "module"],
    ["NodeMCU ESP32 Development Board – Wi-Fi & Bluetooth Enabled", "board"],
    ["Mini Submersible Water Pump – 5V Brushless DC Micro Pump", "actuator"],
    ["Full-Size Solderless Breadboard – 830 Tie Points", "consumable"],
    ["M3 Stainless Steel Phillips Flat Head Screws – 5 Pcs", "fastener"],
    ["Generic 5V 3A AC/DC Power Adapter EU Plug", "power"],
    ["USB Type-A to USB Type-C Cable – 1m White", "power"],
    ["Resistor 330 Ω 1/4 W, through-hole (pack of 10)", "resistor"],
    ["NE555P Precision Timer IC – DIP-8, 2 Pieces", "ic"],
  ])("%s → %s", (name, cls) => {
    expect(d(name).class).toBe(cls);
  });

  it.each([
    "Clear Water Tube for Water Pump – 1 Meter Length",
    "Raspberry Pi 16mm Telephoto Lens – 10MP for HQ Camera",
    "USB Logic Analyzer 8-Channel Module",
    "Rotary Potentiometer – Linear Variable Resistor",
    "M.2 NVME SSD to USB Adapter",
    "Desoldering Pump for Solder Removal",
  ])("%s has no class", (name) => {
    expect(d(name).class).toBeUndefined();
  });

  it("head drops the sale prefix and 'for …'", () => {
    expect(headNoun("Clearance Sale: Bracket for HC-SR04 – Black")).toBe("Bracket");
    expect(classOf("Clear Water Tube")).toBeNull();
  });
});

describe("deriveAttributes — fields", () => {
  it("sensor kind, interface and supply range", () => {
    expect(d("HC-SR501 PIR Motion Sensor - Digital Output")).toMatchObject({ measures: "motion", sensor_type: "pir", interface: "digital" });
    expect(d("Photocell LDR Light Sensor – 4 Pieces Pack")).toMatchObject({ measures: "light", sensor_type: "photo", interface: "analog" });
    expect(d("IR Line Tracking Sensor Module – Adjustable Sensitivity")).toMatchObject({ measures: "other", sensor_type: "ir_reflective" });
    expect(d("UV Light Sensor Module – GUVA-S12SD, Analog Output")).toMatchObject({ sensor_type: "uv" });
    expect(d("Capacitive Analog Soil Moisture Sensor – 3.3–5.5V Output")).toMatchObject({
      measures: "soil_moisture",
      sensor_type: "capacitive",
      interface: "analog",
      supply_min_v: 3.3,
      supply_max_v: 5.5,
    });
    expect(d("Soil Moisture Sensor Module – Analog and Digital Output").interface).toBeUndefined();
  });

  it("resistor value, power, package; ranges and potentiometers give no value", () => {
    expect(d("Resistor 4.7 kΩ 1/4 W, through-hole (pack of 10)")).toMatchObject({ resistance_ohm: 4700, power_w: 0.25, package: "through_hole" });
    expect(parseOhms("Resistor 4K7")).toBe(4700);
    expect(parseOhms("values ranging from 1Ω to 1MΩ")).toBeNull();
    expect(d("1/4W Through-Hole Resistor – 20 Pieces").resistance_ohm).toBeUndefined();
  });

  it("LED colour, size and package; multi-colour kits state no colour", () => {
    expect(d("Green 5mm LED – 5.0V 20mA (5 Pack)")).toMatchObject({ class: "led", color: "green", size_mm: 5, package: "through_hole" });
    expect(d("RGB LED 5mm Common Cathode – 3 Pack").color).toBe("rgb");
    expect(d("5mm LED Kit – Red Yellow Blue Green 20 Pieces").color).toBeUndefined();
  });

  it("module, board, power, consumable, fastener fields", () => {
    expect(d("2 Channel Relay Module")).toMatchObject({ module_type: "relay", channels: 2 });
    expect(d("NodeMCU ESP32 Development Board – Wi-Fi & Bluetooth Enabled")).toMatchObject({ platform: "esp32", logic_v: 3.3 });
    expect(d("Generic 5V 3A AC/DC Power Adapter EU Plug")).toMatchObject({ power_type: "adapter", voltage_v: 5, current_a: 3 });
    expect(d("Full-Size Solderless Breadboard – 830 Tie Points")).toMatchObject({ consumable_type: "breadboard", size: "830" });
    expect(d("Medium Jumper Wires - Male to Female (40 Pack)")).toMatchObject({ consumable_type: "jumper_wires", size: "M-F" });
    expect(d("M3 Stainless Steel Phillips Flat Head Screws – 5 Pcs")).toMatchObject({ fastener_type: "screw", thread: "M3" });
    expect(d("Stainless Steel Hex Socket Screw Kit – M2 M3 M4 M5 Assortment 880 Pcs").thread).toBeUndefined();
  });

  it("pack size from the name", () => {
    expect(parsePack("Green 5mm LED – 5.0V 20mA (5 Pack)")).toBe(5);
    expect(parsePack("Resistor 10 kΩ (pack of 10)")).toBe(10);
    expect(parsePack("Photocell LDR Light Sensor – 4 Pieces Pack")).toBe(4);
    expect(parsePack("1 Channel Relay Module")).toBeNull();
  });
});

describe("E12", () => {
  it.each([
    [120, 120],
    [118, 120],
    [4600, 4700],
    [9600, 10000],
    [250, 270],
    [1, 1],
  ])("%d Ω → %d Ω", (r, e) => {
    expect(nearestE12(r)).toBe(e);
  });
});

describe("effectiveAttributes", () => {
  it("the owner's attributes win; the name fills what they left out", () => {
    const p = { name: "Resistor 1 kΩ 1/4 W, through-hole (pack of 10)", attributes: { class: "resistor", resistance_ohm: 1000, tolerance_pct: 5 } };
    expect(effectiveAttributes(p)).toEqual({
      attributes: { class: "resistor", resistance_ohm: 1000, tolerance_pct: 5, power_w: 0.25, package: "through_hole" },
      derived: false,
    });
  });

  it("an owner class that disagrees with the name is kept as entered", () => {
    const p = { name: "Hex nut M3, stainless steel (pack of 10)", attributes: { class: "header" } };
    expect(effectiveAttributes(p)).toEqual({ attributes: { class: "header" }, derived: false });
  });

  it("no owner class: the parse, marked derived", () => {
    expect(effectiveAttributes({ name: "1 Channel Relay Module", attributes: null }).derived).toBe(true);
  });
});

describe("lineAttributes", () => {
  it("adds the type the line's words state", () => {
    expect(
      lineAttributes({ function: "motion sensor", spec: "PIR, digital output, 5V", class: "sensor", attributes: { measures: "motion", voltage_v: 5 } })
    ).toEqual({ class: "sensor", measures: "motion", sensor_type: "pir", interface: "digital", voltage_v: 5 });
    expect(lineAttributes({ function: "relay module", spec: "1 channel, 5V coil", class: "module", attributes: { voltage_v: 5 } })).toMatchObject({
      module_type: "relay",
      channels: 1,
    });
  });

  it("a line with no class gets one from its words; a resistor value goes to E12", () => {
    expect(lineAttributes({ function: "M3 screws", spec: "M3 x 8 mm" })).toEqual({ class: "fastener", fastener_type: "screw", thread: "M3" });
    expect(lineAttributes({ function: "Resistor", spec: "", class: "resistor", attributes: { resistance_ohm: 118 } }).resistance_ohm).toBe(120);
    expect(lineAttributes({ function: "Silicone tubing", spec: "Connect pump to water output" })).toEqual({});
  });
});
