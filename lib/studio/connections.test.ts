import { describe, expect, it } from "vitest";
import { getPart } from "./library";
import { buildWiring } from "./netlist";
import {
  PIN_BLOCK_END,
  PIN_BLOCK_START,
  SIGNAL_COLOURS,
  boardPinValue,
  buildConnections,
  connectionKey,
  linesUsing,
  pinBlock,
  pinConstants,
  replacePinBlock,
} from "./connections";
import { DEFAULT_SPEC } from "./schema";

const wire = (ids: string[]) => {
  const comps = ids.map((id) => ({ partId: id, instanceId: `${id}_1`, label: id }));
  const w = buildWiring(comps, DEFAULT_SPEC, getPart, "en");
  return { w, cs: buildConnections(w.components, w.netlist.nets, getPart) };
};

const PLANT = ["esp32_devkit", "soil_moisture_cap", "pump_5v", "led_5mm", "usbc_power_5v"];
const UNO = ["arduino_uno", "soil_moisture_cap", "relay_module", "led_5mm", "oled_096_i2c", "dht22"];

describe("buildConnections", () => {
  it("is deterministic with c1.. ids in build order: ground, power, signals", () => {
    const a = wire(PLANT).cs;
    const b = wire(PLANT).cs;
    expect(a).toEqual(b);
    expect(a.map((c) => c.id)).toEqual(a.map((_, i) => `c${i + 1}`));
    const rank = { ground: 0, power: 1 } as Record<string, number>;
    const order = a.map((c) => rank[c.role] ?? 2);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("colours: red supply, black ground, one palette colour per signal net", () => {
    const { cs } = wire(UNO);
    for (const c of cs) {
      if (c.role === "power") expect(c.wireColour).toBe("red");
      else if (c.role === "ground") expect(c.wireColour).toBe("black");
      else expect(SIGNAL_COLOURS).toContain(c.wireColour);
    }
    const byNet = new Map<string, Set<string>>();
    for (const c of cs) byNet.set(c.net, (byNet.get(c.net) ?? new Set()).add(c.wireColour));
    for (const s of byNet.values()) expect(s.size).toBe(1);
  });

  it("covers every pin of every net (one wire per non-hub pin)", () => {
    const { w, cs } = wire(UNO);
    const touched = new Set(cs.flatMap((c) => [`${c.from.part}.${c.from.pin}`, `${c.to.part}.${c.to.pin}`]));
    const via = new Set(cs.filter((c) => c.viaPart).map((c) => c.viaPart!));
    for (const n of w.netlist.nets) {
      for (const r of n.pins) {
        const inst = r.slice(0, r.indexOf("."));
        if (via.has(inst)) continue; // the resistor in series is folded into its wire
        expect(touched.has(r)).toBe(true);
      }
    }
  });

  it("folds board → resistor → LED into one wire with viaPart", () => {
    const { cs } = wire(PLANT);
    const led = cs.find((c) => c.to.partId === "led_5mm" && c.to.label === "+");
    expect(led?.viaPart).toBe("resistor_220_1");
    expect(led?.viaPartId).toBe("resistor_220");
    expect(led?.from.partId).toBe("esp32_devkit");
  });

  it("the USB supply starts its power wire; board pins use short labels", () => {
    const { cs } = wire(PLANT);
    const feed = cs.find((c) => c.to.partId === "esp32_devkit" && c.role === "power");
    expect(feed?.from.partId).toBe("usbc_power_5v");
    const soil = cs.find((c) => c.to.partId === "soil_moisture_cap" && c.role === "analog");
    expect(soil?.from.label).toBe("GPIO36");
  });

  it("connection keys are unique", () => {
    const { cs } = wire(UNO);
    expect(new Set(cs.map(connectionKey)).size).toBe(cs.length);
  });
});

describe("pin constants and the pin block", () => {
  it("names one constant per board signal net with the wire in the comment", () => {
    const { cs } = wire(UNO);
    const k = pinConstants(cs, getPart);
    const names = k.map((x) => x.name);
    expect(names).toContain("LED_PIN");
    expect(names).toContain("SOIL_PIN");
    expect(names).toContain("I2C_SDA_PIN");
    expect(new Set(names).size).toBe(names.length);
    const led = k.find((x) => x.name === "LED_PIN")!;
    expect(led.value).toBe("4");
    const c = cs.find((x) => x.id === led.connectionIds[0])!;
    expect(led.comment).toBe(`${c.wireColour} wire → Indicator light + (${c.id})`);
    expect(k.find((x) => x.name === "SOIL_PIN")!.value).toBe("A0");
  });

  it("boardPinValue reads D/GPIO/GP/A pins", () => {
    expect(boardPinValue("D2")).toBe("2");
    expect(boardPinValue("GPIO04")).toBe("4");
    expect(boardPinValue("GP15")).toBe("15");
    expect(boardPinValue("A0")).toBe("A0");
    expect(boardPinValue("GND_L")).toBeNull();
  });

  it("replaces only the block between the markers", () => {
    const k = pinConstants(wire(UNO).cs, getPart);
    const block = pinBlock(k);
    const code = `#include <Wire.h>\n\n${PIN_BLOCK_START}\nconst int OLD_PIN = 9;  // old\n${PIN_BLOCK_END}\n\nvoid setup() {\n  // my edit\n}\n`;
    const r = replacePinBlock(code, block);
    expect(r.changed).toBe(true);
    expect(r.code).toContain("// my edit");
    expect(r.code).not.toContain("OLD_PIN");
    expect(r.removed).toEqual(["const int OLD_PIN = 9;  // old"]);
    expect(r.added.length).toBe(k.length);
    expect(replacePinBlock(r.code, block).changed).toBe(false);
  });

  it("inserts the block after the includes when there is none", () => {
    const block = pinBlock(pinConstants(wire(PLANT).cs, getPart));
    const r = replacePinBlock("#include <Arduino.h>\nvoid loop() {}\n", block);
    const lines = r.code.split("\n");
    expect(lines[0]).toBe("#include <Arduino.h>");
    expect(lines.indexOf(PIN_BLOCK_START)).toBeGreaterThan(0);
    expect(r.code.endsWith("void loop() {}\n")).toBe(true);
  });

  it("linesUsing finds whole-word uses only", () => {
    const code = "const int LED_PIN = 2;\npinMode(LED_PIN, OUTPUT);\nint LED_PIN2 = 3;";
    expect(linesUsing(code, "LED_PIN")).toEqual([0, 1]);
  });
});
