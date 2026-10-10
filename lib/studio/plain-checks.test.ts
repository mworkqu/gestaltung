import { describe, expect, it } from "vitest";
import { BUTTON, LED, MINI_MCU, MOTOR, RESISTOR, SONAR, comps, lib } from "./__fixtures__/parts";
import { getPart } from "./library";
import { buildNetlist, buildWiring, toLegacyNetlist, type Locale } from "./netlist";
import { CHECK_KEYS, CHECK_TEXT, MAX_CHECK_CHARS, checkText, studioChecks } from "./plain-checks";
import { DEFAULT_SPEC, type ProductSpec, type StudioCheck, type StudioComponent } from "./schema";

const ARABIC = /[؀-ۿ]/;

function expectPlain(checks: StudioCheck[], components: StudioComponent[], locale: Locale) {
  for (const c of checks) {
    expect(c.plain.length).toBeLessThanOrEqual(MAX_CHECK_CHARS);
    expect(c.plain).not.toMatch(/_/);
    for (const comp of components) {
      expect(c.plain).not.toContain(comp.instanceId);
      expect(c.plain).not.toContain(comp.partId);
    }
    if (locale === "ar") expect(c.plain).toMatch(ARABIC);
  }
  expect(checks.filter((c) => c.ok).length).toBeLessThanOrEqual(3);
  expect(new Set(checks.map((c) => c.id)).size).toBe(checks.length);
}

describe("check copy", () => {
  it("has every key in both languages, short and id-free", () => {
    for (const key of CHECK_KEYS) {
      for (const locale of ["en", "ar"] as const) {
        const s = checkText(key, locale, "Temperature and humidity sensor");
        expect(s.length).toBeLessThanOrEqual(MAX_CHECK_CHARS);
        expect(s).not.toMatch(/[_{}]/);
        if (locale === "ar") expect(s).toMatch(ARABIC);
      }
      expect(CHECK_TEXT[key].en).not.toEqual(CHECK_TEXT[key].ar);
    }
  });

  it("falls back to 'this part' when a long name would break the cap", () => {
    const long = "A very long part name that goes on and on and on and on for ever";
    expect(checkText("logic_down", "en", long)).toContain("this part");
    expect(checkText("unpowered", "en", "Small screen")).toBe("Small screen isn't getting power yet.");
  });
});

describe("studioChecks (real library)", () => {
  const set = comps("esp32_devkit", "pir_hcsr501", "oled_096_i2c", "button_6mm", "led_5mm");
  for (const locale of ["en", "ar"] as const) {
    it(`explains the ESP32 set in plain ${locale}`, () => {
      const w = buildWiring(set, DEFAULT_SPEC, getPart, locale);
      expectPlain(w.checks, w.components, locale);
      const fixed = w.checks.filter((c) => !c.ok);
      expect(fixed.map((c) => c.id)).toEqual(["added_resistor"]);
      expect(fixed[0].plain).toBe(CHECK_TEXT.added_resistor[locale]);
      const ok = w.checks.filter((c) => c.ok).map((c) => c.id);
      expect(ok).toEqual(["ok_usb", "ok_voltage", "ok_budget"]);
    });
  }

  it("reassures about the battery when the battery chain is complete", () => {
    const spec: ProductSpec = { ...DEFAULT_SPEC, power: "battery_usb" };
    const w = buildWiring(comps("esp32_devkit", "cell_18650", "tp4056_usbc", "oled_096_i2c"), spec, getPart, "en");
    expect(w.checks.filter((c) => !c.ok)).toEqual([]);
    expect(w.checks[0]).toEqual({ id: "ok_battery_usb", ok: true, plain: "Everything runs from the battery, and it charges over USB." });
  });

  it("asks for a charger, and adds a 5 V booster for a part the battery can't feed", () => {
    const spec: ProductSpec = { ...DEFAULT_SPEC, power: "battery" };
    const w = buildWiring(comps("esp32_devkit", "cell_18650", "pir_hcsr501"), spec, getPart, "en");
    const ids = w.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(ids).toContain("no_charger");
    expect(ids).not.toContain("voltage:pir_hcsr501_1");
    expect(w.components.some((c) => c.partId === "boost_5v" && c.auto)).toBe(true);
    expectPlain(w.checks, w.components, "en");
  });

  it("checks the power source against the idea", () => {
    const noBattery = buildWiring(comps("esp32_devkit"), { ...DEFAULT_SPEC, power: "battery" }, getPart, "ar");
    expect(noBattery.checks.find((c) => c.id === "no_battery")?.plain).toBe(CHECK_TEXT.no_battery.ar);
    const unwanted = buildWiring(comps("esp32_devkit", "cell_18650", "tp4056_usbc"), DEFAULT_SPEC, getPart, "en");
    expect(unwanted.checks.some((c) => c.id === "battery_unwanted")).toBe(true);
  });

  it("powers an Uno from one cell through the 5 V booster", () => {
    const w = buildWiring(comps("arduino_uno", "cell_18650", "tp4056_usbc"), { ...DEFAULT_SPEC, power: "battery_usb" }, getPart, "en");
    expect(w.components.some((c) => c.partId === "boost_5v")).toBe(true);
    expect(w.checks.some((c) => c.id === "supply_range")).toBe(false);
  });
});

describe("studioChecks (fixtures)", () => {
  it("turns the existing hard rules into plain sentences (LED with no resistor)", () => {
    const get = lib(MINI_MCU, LED); // no resistor in this library
    const all = comps("mini_mcu", "led_red");
    const { nets } = buildNetlist(all, DEFAULT_SPEC, get);
    const legacy = toLegacyNetlist(all, nets, get);
    for (const locale of ["en", "ar"] as const) {
      const checks = studioChecks(all, nets, legacy, DEFAULT_SPEC, get, locale);
      expect(checks.find((c) => c.id === "led_no_resistor:led_red_1")?.plain).toBe(checkText("led_no_resistor", locale, locale === "en" ? "Red light" : "قطعة 7"));
      expectPlain(checks, all, locale);
    }
  });

  it("flags a 5 V signal into a 3.3 V board when no adapter exists, and a motor with no driver", () => {
    const get = lib(MINI_MCU, SONAR, MOTOR, BUTTON, RESISTOR);
    const w = buildWiring(comps("mini_mcu", "sonar_5v", "dc_motor"), DEFAULT_SPEC, get, "en");
    const ids = w.checks.filter((c) => !c.ok).map((c) => c.id);
    expect(ids).toContain("logic_up:sonar_5v_1");
    expect(ids).toContain("inductive_on_gpio:dc_motor_1");
    expect(w.checks.find((c) => c.id === "logic_up:sonar_5v_1")?.plain).toBe(
      "Distance sensor sends signals too strong for the board; it needs an adapter.",
    );
    expectPlain(w.checks, w.components, "en");
  });

  it("asks for a board when there is none", () => {
    const get = lib(BUTTON);
    const w = buildWiring(comps("btn_tact"), DEFAULT_SPEC, get, "en");
    expect(w.checks.map((c) => c.id)).toContain("no_mcu");
  });
});
