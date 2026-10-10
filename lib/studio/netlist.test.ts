import { describe, expect, it } from "vitest";
import { findController } from "@/lib/prototyping/firmware";
import { crossValidate, hardRules, sanityChecks } from "@/lib/prototyping/netlist";
import { BUTTON, DRIVER, LED, MINI_MCU, MOTOR, RESISTOR, SHIFTER, SONAR, comps, lib } from "./__fixtures__/parts";
import { getPart } from "./library";
import { buildNetlist, buildWiring, resolveRequired, splitRef, toLegacyNetlist } from "./netlist";
import { DEFAULT_SPEC, type Net } from "./schema";

const spec = DEFAULT_SPEC;
const netNamed = (nets: Net[], name: string) => nets.find((n) => n.name === name);
const netOfPin = (nets: Net[], ref: string) => nets.find((n) => n.pins.includes(ref));

describe("resolveRequired", () => {
  it("adds one resistor per LED with auto:true and deterministic ids", () => {
    const get = lib(MINI_MCU, LED, RESISTOR);
    const r = resolveRequired(comps("mini_mcu", "led_red", "led_red"), get);
    expect(r.added).toEqual([
      { instanceId: "res_330_1", partId: "res_330", reasonKey: "resistor" },
      { instanceId: "res_330_2", partId: "res_330", reasonKey: "resistor" },
    ]);
    const added = r.components.filter((c) => c.auto);
    expect(added.map((c) => c.instanceId)).toEqual(["res_330_1", "res_330_2"]);
    expect(added.every((c) => c.reason && c.label)).toBe(true);
  });

  it("does not add what is already there, and skips helpers missing from the library", () => {
    const withRes = resolveRequired(comps("mini_mcu", "led_red", "res_330"), lib(MINI_MCU, LED, RESISTOR));
    expect(withRes.added).toEqual([]);
    const noRes = resolveRequired(comps("mini_mcu", "led_red"), lib(MINI_MCU, LED));
    expect(noRes.added).toEqual([]);
  });

  it("skips taken instance ids", () => {
    const c = [...comps("mini_mcu", "led_red"), { partId: "res_330", instanceId: "res_330_1", label: "x" }, ...comps("led_red").map((x) => ({ ...x, instanceId: "led_red_2" }))];
    const r = resolveRequired(c, lib(MINI_MCU, LED, RESISTOR));
    expect(r.added.map((a) => a.instanceId)).toEqual(["res_330_2"]);
  });

  it("adds a level shifter for a 5 V signal into a 3.3 V board (when the library has one)", () => {
    const r = resolveRequired(comps("mini_mcu", "sonar_5v"), lib(MINI_MCU, SONAR, SHIFTER));
    expect(r.added).toEqual([{ instanceId: "level_shifter_4ch_1", partId: "level_shifter_4ch", reasonKey: "level_shifter" }]);
    expect(resolveRequired(comps("mini_mcu", "sonar_5v"), lib(MINI_MCU, SONAR)).added).toEqual([]);
  });

  it("adds a driver for a motor (when the library has one)", () => {
    const r = resolveRequired(comps("mini_mcu", "dc_motor"), lib(MINI_MCU, MOTOR, DRIVER));
    expect(r.added.map((a) => a.reasonKey)).toEqual(["driver"]);
  });
});

describe("buildNetlist (fixtures)", () => {
  it("wires an LED in series: board pin → resistor → LED anode, cathode → GND", () => {
    const get = lib(MINI_MCU, LED, RESISTOR);
    const all = resolveRequired(comps("mini_mcu", "led_red"), get).components;
    const { nets } = buildNetlist(all, spec, get);
    expect(netNamed(nets, "LED1")?.pins).toEqual(["mini_mcu_1.G1", "res_330_1.1"]);
    expect(netNamed(nets, "LED1_A")?.pins).toEqual(["res_330_1.2", "led_red_1.A"]);
    expect(netNamed(nets, "GND")?.pins).toContain("led_red_1.K");
  });

  it("wires a button between a board pin and GND", () => {
    const { nets } = buildNetlist(comps("mini_mcu", "btn_tact"), spec, lib(MINI_MCU, BUTTON));
    expect(netNamed(nets, "BTN1")?.pins).toEqual(["mini_mcu_1.G1", "btn_tact_1.P2"]);
    expect(netNamed(nets, "GND")?.pins).toEqual(["mini_mcu_1.GND", "btn_tact_1.P1"]);
  });

  it("leaves pins unconnected (and records them) when the board runs out", () => {
    // 2 gpio + 1 pwm + I2C pair (spare when no I2C device) = 5 digital pins for 6 buttons.
    const get = lib(MINI_MCU, BUTTON);
    const c = comps("mini_mcu", ...Array(6).fill("btn_tact"));
    const r = buildNetlist(c, spec, get);
    const btnNets = r.nets.filter((n) => /^BTN\d$/.test(n.name));
    expect(btnNets.map((n) => n.name)).toEqual(["BTN1", "BTN2", "BTN3", "BTN4", "BTN5"]);
    expect(btnNets.map((n) => n.pins[0])).toEqual(["mini_mcu_1.G1", "mini_mcu_1.G2", "mini_mcu_1.G3", "mini_mcu_1.SDA", "mini_mcu_1.SCL"]);
    expect(r.unconnected).toEqual(["btn_tact_6.P2"]);
    const w = buildWiring(c, spec, get, "en");
    expect(w.checks.some((x) => !x.ok && /ran out/.test(x.plain))).toBe(true);
  });

  it("routes a 5 V output through a level shifter channel", () => {
    const get = lib(MINI_MCU, SONAR, SHIFTER);
    const all = resolveRequired(comps("mini_mcu", "sonar_5v"), get).components;
    const { nets } = buildNetlist(all, spec, get);
    const mcuSide = netNamed(nets, "SONAR_ECHO")!;
    expect(mcuSide.pins).toEqual(["mini_mcu_1.G1", "level_shifter_4ch_1.LV1"]);
    expect(netNamed(nets, "SONAR_ECHO_5V")?.pins).toEqual(["level_shifter_4ch_1.HV1", "sonar_5v_1.ECHO"]);
    // TRIG is driven by the board: 3.3 V into 5 V needs no shifter.
    expect(netNamed(nets, "SONAR_TRIG")?.pins).toEqual(["mini_mcu_1.G2", "sonar_5v_1.TRIG"]);
    expect(netOfPin(nets, "sonar_5v_1.VCC")?.name).toBe("5V");
    expect(netOfPin(nets, "level_shifter_4ch_1.LV")?.name).toBe("3V3");
    expect(netOfPin(nets, "level_shifter_4ch_1.HV")?.name).toBe("5V");
  });

  it("puts a motor behind its driver, never straight on a board pin", () => {
    const get = lib(MINI_MCU, MOTOR, DRIVER);
    const w = buildWiring(comps("mini_mcu", "dc_motor"), spec, get, "en");
    const motorNet = netOfPin(w.netlist.nets, "dc_motor_1.PLUS")!;
    expect(motorNet.pins).toEqual(["mosfet_driver_1.OUT", "dc_motor_1.PLUS"]);
    expect(netOfPin(w.netlist.nets, "mosfet_driver_1.IN")?.pins[0]).toBe("mini_mcu_1.G1");
    expect(hardRules(w.legacy).filter((f) => f.code === "inductive_on_gpio")).toEqual([]);
    expect(sanityChecks(w.legacy).filter((f) => f.code === "unpowered")).toEqual([]);
  });

  it("never puts one pin on two nets", () => {
    const get = lib(MINI_MCU, LED, RESISTOR, BUTTON, SONAR, SHIFTER, MOTOR, DRIVER);
    const w = buildWiring(comps("mini_mcu", "led_red", "btn_tact", "sonar_5v", "dc_motor"), spec, get, "en");
    const seen = new Set<string>();
    for (const n of w.netlist.nets) for (const r of n.pins) {
      expect(seen.has(r)).toBe(false);
      seen.add(r);
    }
    expect(crossValidate(w.legacy, w.legacy.components.map((c) => c.bomId))).toEqual([]);
  });
});

// ── Integration: the real library ──────────────────────────────────────────

const ESP_SET = ["esp32_devkit", "pir_hcsr501", "oled_096_i2c", "button_6mm"];

describe("buildWiring (real library: ESP32 + PIR + OLED + button)", () => {
  const w = buildWiring(comps(...ESP_SET), spec, getPart, "en");
  const nets = w.netlist.nets;
  const esp = getPart("esp32_devkit")!;
  const role = (ref: string) => esp.pins.find((p) => p.id === splitRef(ref)[1])?.role;

  it("puts the PIR output on its own gpio", () => {
    const n = netNamed(nets, "PIR_OUT")!;
    expect(n.pins).toHaveLength(2);
    expect(n.pins).toContain("pir_hcsr501_1.OUT");
    const board = n.pins.find((r) => r.startsWith("esp32_devkit_1."))!;
    expect(role(board)).toBe("gpio");
  });

  it("puts the OLED on the board's I2C pins 21/22", () => {
    expect(netNamed(nets, "SDA")?.pins).toEqual(["esp32_devkit_1.GPIO21", "oled_096_i2c_1.SDA"]);
    expect(netNamed(nets, "SCL")?.pins).toEqual(["esp32_devkit_1.GPIO22", "oled_096_i2c_1.SCL"]);
  });

  it("wires the button to a gpio and GND", () => {
    const btn = netNamed(nets, "BTN1")!;
    expect(btn.pins).toContain("button_6mm_1.B");
    expect(role(btn.pins.find((r) => r.startsWith("esp32_devkit_1."))!)).toBe("gpio");
    expect(netNamed(nets, "GND")?.pins).toContain("button_6mm_1.A");
  });

  it("ties every ground together", () => {
    const gnd = netNamed(nets, "GND")!.pins;
    for (const id of ESP_SET.slice(1)) {
      for (const p of getPart(id)!.pins.filter((x) => x.role === "gnd")) expect(gnd).toContain(`${id}_1.${p.id}`);
    }
    expect(gnd.some((r) => r.startsWith("esp32_devkit_1.GND"))).toBe(true);
  });

  it("powers each peripheral from a rail inside its voltage range", () => {
    const railV: Record<string, number> = { "3V3": 3.3, "5V": 5 };
    for (const id of ["pir_hcsr501", "oled_096_i2c"]) {
      const p = getPart(id)!;
      for (const pin of p.pins.filter((x) => x.role === "vin" || x.role === "3v3" || x.role === "5v")) {
        const n = netOfPin(nets, `${id}_1.${pin.id}`)!;
        expect(Object.keys(railV)).toContain(n.name);
        expect(railV[n.name]).toBeGreaterThanOrEqual(p.power.vMin);
        expect(railV[n.name]).toBeLessThanOrEqual(p.power.vMax);
      }
    }
    expect(netOfPin(nets, "oled_096_i2c_1.VCC")?.name).toBe("3V3");
    expect(netOfPin(nets, "pir_hcsr501_1.VCC")?.name).toBe("5V");
    expect(w.unconnected).toEqual([]);
  });

  it("gives the legacy rules a clean, valid netlist the firmware generator recognises", () => {
    expect(crossValidate(w.legacy, w.legacy.components.map((c) => c.bomId))).toEqual([]);
    expect(hardRules(w.legacy)).toEqual([]);
    expect(sanityChecks(w.legacy)).toEqual([]);
    expect(findController(w.legacy)?.function).toMatch(/ESP32 microcontroller/);
    expect(w.legacy.powerRails).toEqual([
      { name: "5V", sourceRef: "esp32_devkit_1", maxCurrentMa: 450 },
      { name: "3V3", sourceRef: "esp32_devkit_1", maxCurrentMa: 500 },
    ]);
  });

  it("is deterministic", () => {
    const again = buildWiring(comps(...ESP_SET), spec, getPart, "en");
    expect(JSON.stringify(again)).toBe(JSON.stringify(w));
  });
});

describe("buildWiring (real library: LED, Uno, battery)", () => {
  it("adds the LED resistor and wires it in series; no led_no_resistor flag", () => {
    const w = buildWiring(comps("esp32_devkit", "led_5mm"), spec, getPart, "en");
    expect(w.added).toEqual([{ instanceId: "resistor_220_1", partId: "resistor_220", reasonKey: "resistor" }]);
    expect(w.components.find((c) => c.instanceId === "resistor_220_1")?.auto).toBe(true);
    const led1 = netNamed(w.netlist.nets, "LED1")!;
    expect(led1.pins[1]).toBe("resistor_220_1.1");
    expect(netNamed(w.netlist.nets, "LED1_A")?.pins).toEqual(["resistor_220_1.2", "led_5mm_1.A"]);
    expect(netNamed(w.netlist.nets, "GND")?.pins).toContain("led_5mm_1.K");
    expect(hardRules(w.legacy).some((f) => f.code === "led_no_resistor")).toBe(false);
  });

  it("flags an LED without a resistor when none is available", () => {
    const noResistor = (id: string) => (id === "resistor_220" ? undefined : getPart(id));
    const all = comps("esp32_devkit", "led_5mm");
    const { nets } = buildNetlist(all, spec, noResistor);
    const legacy = toLegacyNetlist(all, nets, noResistor);
    expect(hardRules(legacy).map((f) => f.code)).toContain("led_no_resistor");
  });

  it("uses A4/A5 for I2C on the Uno and powers 5 V parts from its 5V pin", () => {
    const w = buildWiring(comps("arduino_uno", "pir_hcsr501", "oled_096_i2c", "button_6mm"), spec, getPart, "en");
    expect(netNamed(w.netlist.nets, "SDA")?.pins).toEqual(["arduino_uno_1.A4", "oled_096_i2c_1.SDA"]);
    expect(netNamed(w.netlist.nets, "SCL")?.pins).toEqual(["arduino_uno_1.A5", "oled_096_i2c_1.SCL"]);
    expect(netOfPin(w.netlist.nets, "pir_hcsr501_1.VCC")?.name).toBe("5V");
    expect(netNamed(w.netlist.nets, "PIR_OUT")?.pins[0]).toBe("arduino_uno_1.D2");
    expect(findController(w.legacy)?.function).toMatch(/Arduino Uno microcontroller/);
    expect(hardRules(w.legacy)).toEqual([]);
  });

  it("feeds the board from battery → charger, battery minus through the charger", () => {
    const w = buildWiring(comps("esp32_devkit", "cell_18650", "tp4056_usbc", "oled_096_i2c"), { ...spec, power: "battery_usb" }, getPart, "en");
    const nets = w.netlist.nets;
    expect(netNamed(nets, "VBAT")?.pins).toEqual(["cell_18650_1.BAT_PLUS", "tp4056_usbc_1.B_PLUS"]);
    expect(netNamed(nets, "BAT-")?.pins).toEqual(["cell_18650_1.BAT_MINUS", "tp4056_usbc_1.B_MINUS"]);
    expect(netNamed(nets, "VSYS")?.pins).toEqual(["tp4056_usbc_1.OUT_PLUS", "esp32_devkit_1.VIN"]);
    expect(netNamed(nets, "GND")?.pins).toContain("tp4056_usbc_1.OUT_MINUS");
    expect(hardRules(w.legacy).filter((f) => f.code === "shorted_supplies")).toEqual([]);
  });
});
