// Part F regression: the five P5-16 acceptance ideas (plant waterer, desk lamp, cat feeder,
// doorbell, TV remote) pick and wire EXACTLY as before the chat + multi-actuator stage
// (commit e2dbf23, checked by running the old and new code side by side on 2026-10-13):
// one pump, one servo, no servo driver, no 5 A supply, same nets, same plain checks.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { enforcePick } from "./ai/pick";
import { getPart, libraryIndexForAI } from "./library";
import { buildWiring } from "./netlist";
import { GOLDEN_IDEAS } from "./product/__fixtures__/golden";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

/** Output of the pre-stage code (e2dbf23) for each golden idea. plant_waterer: since 2026-10-18 a pump
 *  that only switches on/off gets a MOSFET switch (5 V load power) instead of the H-bridge. */
const BEFORE: Record<string, { picked: string[]; wired: string[]; nets: string[]; checks: string[] }> = {
  "plant_waterer": {
    "picked": [
      "esp32_c3_mini_1",
      "soil_moisture_cap_1",
      "pump_5v_1",
      "mosfet_module_1",
      "ws2812_ring_1"
    ],
    "wired": [
      "esp32_c3_mini_1",
      "soil_moisture_cap_1",
      "pump_5v_1",
      "mosfet_module_1",
      "ws2812_ring_1"
    ],
    "nets": [
      "3V3:esp32_c3_mini_1.3V3,soil_moisture_cap_1.VCC",
      "5V:esp32_c3_mini_1.VIN,mosfet_module_1.VIN,ws2812_ring_1.VCC",
      "GND:esp32_c3_mini_1.GND_L,mosfet_module_1.GND,pump_5v_1.M_MINUS,soil_moisture_cap_1.GND,ws2812_ring_1.GND",
      "MOSFET_SIG:esp32_c3_mini_1.GPIO3,mosfet_module_1.SIG",
      "PUMP_PUMP:mosfet_module_1.OUT,pump_5v_1.M_PLUS",
      "SOIL_AOUT:esp32_c3_mini_1.GPIO2,soil_moisture_cap_1.AOUT",
      "WS2812_DIN:esp32_c3_mini_1.GPIO10,ws2812_ring_1.DIN"
    ],
    "checks": [
      "ok_usb:true",
      "ok_voltage:true",
      "ok_budget:true"
    ]
  },
  "desk_lamp": {
    "picked": [
      "esp32_c3_mini_1",
      "ws2812_ring_1"
    ],
    "wired": [
      "esp32_c3_mini_1",
      "ws2812_ring_1"
    ],
    "nets": [
      "5V:esp32_c3_mini_1.VIN,ws2812_ring_1.VCC",
      "GND:esp32_c3_mini_1.GND_L,ws2812_ring_1.GND",
      "WS2812_DIN:esp32_c3_mini_1.GPIO3,ws2812_ring_1.DIN"
    ],
    "checks": [
      "ok_usb:true",
      "ok_voltage:true",
      "ok_budget:true"
    ]
  },
  "cat_feeder": {
    "picked": [
      "esp32_devkit_1",
      "sg90_servo_1",
      "usbc_power_5v_1",
      "button_6mm_1"
    ],
    "wired": [
      "esp32_devkit_1",
      "sg90_servo_1",
      "usbc_power_5v_1",
      "button_6mm_1"
    ],
    "nets": [
      "5V:esp32_devkit_1.VIN,sg90_servo_1.VCC,usbc_power_5v_1.OUT_5V",
      "BTN1:button_6mm_1.B,esp32_devkit_1.GPIO26",
      "GND:button_6mm_1.A,esp32_devkit_1.GND_L,sg90_servo_1.GND,usbc_power_5v_1.GND",
      "SG90_SIGNAL:esp32_devkit_1.GPIO25,sg90_servo_1.SIG"
    ],
    "checks": [
      "ok_mains:true",
      "ok_voltage:true",
      "ok_budget:true"
    ]
  },
  "doorbell": {
    "picked": [
      "esp32_c3_mini_1",
      "button_6mm_1",
      "speaker_amp_1",
      "lipo_1000_1",
      "tp4056_usbc_1"
    ],
    "wired": [
      "esp32_c3_mini_1",
      "button_6mm_1",
      "speaker_amp_1",
      "lipo_1000_1",
      "tp4056_usbc_1"
    ],
    "nets": [
      "3V3:esp32_c3_mini_1.3V3,speaker_amp_1.VCC",
      "BAT-:lipo_1000_1.BAT_MINUS,tp4056_usbc_1.B_MINUS",
      "BTN1:button_6mm_1.B,esp32_c3_mini_1.GPIO3",
      "GND:button_6mm_1.A,esp32_c3_mini_1.GND_L,speaker_amp_1.GND,tp4056_usbc_1.OUT_MINUS",
      "SPEAKER_IN:esp32_c3_mini_1.GPIO10,speaker_amp_1.IN",
      "VBAT:lipo_1000_1.BAT_PLUS,tp4056_usbc_1.B_PLUS",
      "VSYS:esp32_c3_mini_1.VIN,tp4056_usbc_1.OUT_PLUS"
    ],
    "checks": [
      "ok_battery_usb:true",
      "ok_voltage:true",
      "ok_budget:true"
    ]
  },
  "tv_remote": {
    "picked": [
      "esp32_c3_mini_1",
      "button_6mm_1",
      "button_6mm_2",
      "button_6mm_3",
      "aa_holder_2_1"
    ],
    "wired": [
      "esp32_c3_mini_1",
      "button_6mm_1",
      "button_6mm_2",
      "button_6mm_3",
      "aa_holder_2_1",
      "boost_5v_1*"
    ],
    "nets": [
      "BTN1:button_6mm_1.B,esp32_c3_mini_1.GPIO3",
      "BTN2:button_6mm_2.B,esp32_c3_mini_1.GPIO10",
      "BTN3:button_6mm_3.B,esp32_c3_mini_1.GPIO4",
      "GND:aa_holder_2_1.BAT_MINUS,boost_5v_1.GND_IN,boost_5v_1.GND_OUT,button_6mm_1.A,button_6mm_2.A,button_6mm_3.A,esp32_c3_mini_1.GND_L",
      "VBAT:aa_holder_2_1.BAT_PLUS,boost_5v_1.VIN",
      "VREG:boost_5v_1.OUT_5V,esp32_c3_mini_1.VIN"
    ],
    "checks": [
      "added_helper:boost_5v_1:false",
      "no_charger:false",
      "ok_pins:true",
      "ok_ground:true"
    ]
  }
};

describe("golden ideas are unchanged by the multi-actuator stage", () => {
  for (const g of GOLDEN_IDEAS) {
    it(`${g.key}: same parts, same wiring, same checks`, () => {
      const picked = enforcePick(
        { components: g.partIds.map((partId) => ({ partId })) },
        { spec: g.spec, index: libraryIndexForAI(), locale: "en", log: [], nameFor: (id) => getPart(id)?.name.en, pinsOf: (id) => getPart(id)?.pins },
      );
      const w = buildWiring(picked.components, g.spec, getPart, "en");
      expect({
        picked: picked.components.map((c) => c.instanceId),
        wired: w.components.map((c) => `${c.instanceId}${c.auto ? "*" : ""}`),
        nets: w.netlist.nets.map((n) => `${n.name}:${[...n.pins].sort().join(",")}`).sort(),
        checks: w.checks.map((c) => `${c.id}:${c.ok}`),
      }).toEqual(BEFORE[g.key]);
      const ids = picked.components.map((c) => c.partId);
      expect(ids.filter((id) => id === "pump_5v").length).toBeLessThanOrEqual(1);
      expect(ids).not.toContain("pca9685_servo");
      expect(ids).not.toContain("mg996r_servo");
      expect(ids).not.toContain("psu_5v_5a");
    });
  }
});
