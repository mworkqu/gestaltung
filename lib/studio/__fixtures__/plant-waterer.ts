// The QA tester's walk of the live Studio (2026-10): "An automatic plant waterer for my
// balcony. It checks if the soil is dry and waters the plant with a small pump. Powered by
// USB. I want a light that shows when the water tank is empty."
//
// The kit, the wiring and the firmware it produced each carried a fault (F-007, F-010, F-011,
// F-012, F-052). These fixtures hold that case so the rules that refuse it stay refused.

import { clampSpec, type Net, type ProductSpec, type StudioComponent } from "../schema";

export const PLANT_WATERER_BRIEF =
  "An automatic plant waterer for my balcony. It checks if the soil is dry and waters the plant " +
  "with a small pump. Powered by USB. I want a light that shows when the water tank is empty.";

const comp = (partId: string, n = 1): StudioComponent => ({ partId, instanceId: `${partId}_${n}`, label: partId });

/** The parts the picker chose, in the order the Studio wires them. */
export const PLANT_WATERER: { spec: ProductSpec; components: StudioComponent[] } = {
  spec: clampSpec({
    name: "Plant Waterer",
    oneLine: "Waters your plant automatically when the soil gets dry.",
    use: "desk",
    power: "usb",
    environment: "indoor",
    features: ["automatic watering", "soil moisture sensing", "tank empty light", "small pump"],
    inputs: [],
    outputs: ["led", "pump"],
    sizeHint: "palm",
    style: "rounded",
    placement: "plant_soil",
    quantity: 1,
  }),
  components: [
    comp("esp32_c3_mini"),
    comp("soil_moisture_cap"),
    comp("pump_5v"),
    comp("mosfet_module"),
    comp("ws2812_ring"),
  ],
};

/**
 * The nets the tester actually got: the pump's + on the module's switched terminal and its
 * return straight on GND, so the MOSFET is bypassed and the pump can never be switched off.
 */
export const PLANT_WATERER_BROKEN_NETS: Net[] = [
  { name: "3V3", pins: ["esp32_c3_mini_1.3V3", "soil_moisture_cap_1.VCC"] },
  { name: "5V", pins: ["esp32_c3_mini_1.VIN", "mosfet_module_1.VIN", "ws2812_ring_1.VCC"] },
  {
    name: "GND",
    pins: [
      "esp32_c3_mini_1.GND_L",
      "mosfet_module_1.GND",
      "pump_5v_1.M_MINUS",
      "soil_moisture_cap_1.GND",
      "ws2812_ring_1.GND",
    ],
  },
  { name: "MOSFET_SIG", pins: ["esp32_c3_mini_1.GPIO3", "mosfet_module_1.SIG"] },
  { name: "PUMP_PUMP", pins: ["mosfet_module_1.OUT", "pump_5v_1.M_PLUS"] },
  { name: "SOIL_AOUT", pins: ["esp32_c3_mini_1.GPIO2", "soil_moisture_cap_1.AOUT"] },
  { name: "WS2812_DIN", pins: ["esp32_c3_mini_1.GPIO10", "ws2812_ring_1.DIN"] },
];

/**
 * The understanding card the model wrote for the same brief: it promised a tank-level part the
 * library has no answer for ("float switch or sensor detects when the tank is empty", F-011)
 * and two features the tester never asked for ("Motion sensor", a small screen, F-012).
 */
export const PLANT_WATERER_CARD: ProductSpec = clampSpec({
  ...PLANT_WATERER.spec,
  features: ["Automatic watering", "Soil moisture sensing", "Tank empty light", "Motion sensor", "Shows information on a small screen"],
  understanding: {
    goal: "Water a balcony plant when the soil is dry.",
    howItWorks: "The probe reads the soil; when it is dry the pump runs for a few seconds.",
    controller: "ESP32-C3 mini",
    sensors: [
      { name: "Soil moisture sensor", count: 1, purpose: "tells when the pot is dry" },
      { name: "Float switch", count: 1, purpose: "detects when the tank is empty" },
    ],
    actuators: [{ kind: "pump", count: 1, name: "Small water pump", purpose: "waters the plant" }],
    outputs: [{ name: "Status light", count: 1, purpose: "shows what it is doing" }],
  },
});
