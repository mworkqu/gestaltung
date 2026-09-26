// Test fixture (vitest only): the Plant monitor circuit as the model drew it
// on the audit project — an ESP32 fed 5 V from a USB connector, a DHT11, four
// LEDs straight on GPIOs, a 5 V pump straight on a GPIO, and the board's 5V
// pin declared as a second supply on the 5V net.

import type { ProjectLine } from "./bom";
import type { Netlist, Pin, PinType } from "./netlist";

const pin = (id: string, type: PinType, name = id): Pin => ({ id, name, type });

export const plantLines: ProjectLine[] = [
  { id: "e_usb", function: "USB connector", spec: "USB-C, 5 V", quantity: 1, kind: "electronics", critical: true, class: "header", attributes: { class: "header" }, origin: "electronics" },
  { id: "e_esp32", function: "ESP32 development board", spec: "3.3 V logic, WiFi", quantity: 1, kind: "electronics", critical: true, class: "board", attributes: { class: "board", platform: "esp32", logic_v: 3.3 }, origin: "electronics" },
  { id: "e_dht11", function: "DHT11 sensor", spec: "temperature and humidity", quantity: 1, kind: "electronics", critical: true, class: "sensor", attributes: { class: "sensor", measures: "humidity", interface: "digital" }, origin: "electronics" },
  { id: "e_led", function: "status LED", spec: "5 mm red", quantity: 4, kind: "electronics", critical: true, class: "led", attributes: { class: "led", color: "red" }, origin: "electronics" },
  { id: "e_pump", function: "water pump", spec: "5 V DC submersible", quantity: 1, kind: "electronics", critical: true, class: "actuator", attributes: { class: "actuator", actuator_type: "pump", voltage_v: 5 }, origin: "electronics" },
];

const led = (i: number) => ({
  ref: `LED${i}`,
  function: "status LED",
  bomId: "e_led",
  currentMa: 10,
  pins: [pin("A", "input", "anode"), pin("K", "passive", "cathode")],
});

export function plantNetlist(): Netlist {
  return {
    components: [
      { ref: "J1", function: "USB connector", bomId: "e_usb", currentMa: 0, pins: [pin("VBUS", "power_out"), pin("GND", "ground")] },
      {
        ref: "U1",
        function: "ESP32 development board",
        bomId: "e_esp32",
        currentMa: 240,
        pins: [
          pin("5V", "power_out"),
          pin("3V3", "power_out"),
          pin("GND", "ground"),
          pin("IO4", "bidirectional"),
          pin("IO16", "output"),
          pin("IO17", "output"),
          pin("IO18", "output"),
          pin("IO19", "output"),
          pin("IO25", "output"),
        ],
      },
      { ref: "U2", function: "DHT11 sensor", bomId: "e_dht11", currentMa: 2.5, pins: [pin("VCC", "power_in"), pin("DATA", "bidirectional"), pin("GND", "ground")] },
      led(1),
      led(2),
      led(3),
      led(4),
      { ref: "M1", function: "water pump", bomId: "e_pump", currentMa: 150, pins: [pin("1", "input", "+"), pin("2", "ground", "-")] },
    ],
    nets: [
      { name: "5V", connections: [{ ref: "J1", pin: "VBUS" }, { ref: "U1", pin: "5V" }] },
      { name: "3V3", connections: [{ ref: "U1", pin: "3V3" }, { ref: "U2", pin: "VCC" }] },
      {
        name: "GND",
        connections: [
          { ref: "J1", pin: "GND" },
          { ref: "U1", pin: "GND" },
          { ref: "U2", pin: "GND" },
          { ref: "LED1", pin: "K" },
          { ref: "LED2", pin: "K" },
          { ref: "LED3", pin: "K" },
          { ref: "LED4", pin: "K" },
          { ref: "M1", pin: "2" },
        ],
      },
      { name: "DHT", connections: [{ ref: "U1", pin: "IO4" }, { ref: "U2", pin: "DATA" }] },
      { name: "LED_OK", connections: [{ ref: "U1", pin: "IO16" }, { ref: "LED1", pin: "A" }] },
      { name: "LED_DRY", connections: [{ ref: "U1", pin: "IO17" }, { ref: "LED2", pin: "A" }] },
      { name: "LED_WET", connections: [{ ref: "U1", pin: "IO18" }, { ref: "LED3", pin: "A" }] },
      { name: "LED_WIFI", connections: [{ ref: "U1", pin: "IO19" }, { ref: "LED4", pin: "A" }] },
      { name: "PUMP", connections: [{ ref: "U1", pin: "IO25" }, { ref: "M1", pin: "1" }] },
    ],
    powerRails: [
      { name: "5V", sourceRef: "J1", maxCurrentMa: 500 },
      { name: "3V3", sourceRef: "U1", maxCurrentMa: 600 },
    ],
    notes: [],
  };
}

/** A translator that returns the key and its params, so tests can read what was said. */
export const tKey = (k: string, p?: Record<string, string | number>) => (p ? `${k} ${JSON.stringify(p)}` : k);

/** ESP32 with a voltage divider R1/R2 to GND, and LED1 straight from IO2 to GND (review defect 1). */
export function dividerNetlist(): Netlist {
  return {
    components: [
      { ref: "J1", function: "USB connector", bomId: "e_usb", currentMa: 0, pins: [pin("VBUS", "power_out"), pin("GND", "ground")] },
      { ref: "U1", function: "ESP32 development board", bomId: "e_esp32", currentMa: 240, pins: [pin("VIN", "power_in"), pin("GND", "ground"), pin("IO2", "output"), pin("IO34", "input")] },
      { ref: "R1", function: "resistor", bomId: "e_div", pins: [pin("1", "passive"), pin("2", "passive")] },
      { ref: "R2", function: "resistor", bomId: "e_div", pins: [pin("1", "passive"), pin("2", "passive")] },
      { ref: "LED1", function: "status LED", bomId: "e_led", currentMa: 10, pins: [pin("A", "input", "anode"), pin("K", "passive", "cathode")] },
    ],
    nets: [
      { name: "5V", connections: [{ ref: "J1", pin: "VBUS" }, { ref: "U1", pin: "VIN" }, { ref: "R1", pin: "1" }] },
      { name: "GND", connections: [{ ref: "J1", pin: "GND" }, { ref: "U1", pin: "GND" }, { ref: "R2", pin: "2" }, { ref: "LED1", pin: "K" }] },
      { name: "SENSE", connections: [{ ref: "R1", pin: "2" }, { ref: "R2", pin: "1" }, { ref: "U1", pin: "IO34" }] },
      { name: "LED", connections: [{ ref: "U1", pin: "IO2" }, { ref: "LED1", pin: "A" }] },
    ],
    powerRails: [{ name: "5V", sourceRef: "J1", maxCurrentMa: 500 }],
    notes: [],
  };
}
