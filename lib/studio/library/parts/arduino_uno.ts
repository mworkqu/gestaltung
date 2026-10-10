import type { LibraryPart, Pin, PinRole } from "../../schema";

// Arduino Uno R3: 68.6 x 53.3 mm. USB-B (top-left) and DC jack (bottom-left) face -x.
// Mount holes are the standard four, converted from lower-left origin to board centre.
const ox = 68.6 / 2;
const oy = 53.3 / 2;

const digital = (n: number, role: PinRole, label = `D${n}`): Pin => ({
  id: `D${n}`, label, role, voltage: 5, side: "top",
});
const analog = (n: number, role: PinRole = "adc", label = `A${n}`): Pin => ({
  id: `A${n}`, label, role, voltage: 5, side: "bottom",
});

export const arduinoUno: LibraryPart = {
  id: "arduino_uno",
  name: { en: "Arduino Uno brain board", ar: "لوحة التحكم أردوينو أونو" },
  blurb: {
    en: "A beginner-friendly board that reads sensors and switches things on and off.",
    ar: "لوحة سهلة للمبتدئين تقرأ الحسّاسات وتشغّل الأشياء وتطفئها.",
  },
  category: "mcu",
  storeSkus: [],
  tags: ["arduino", "uno", "atmega328", "microcontroller", "brain", "controller", "beginner", "5v", "prototype", "learning"],
  dims: { x: 68.6, y: 53.3, z: 12.5 },
  model: {
    kind: "procedural",
    builder: "devBoard",
    params: {
      chip: "atmega",
      usb: "typeB",
      jack: true,
      boardT: 1.6,
      rows: [
        { y: 24.15, x0: -3.1, n: 10, kind: "socket", h: 8.5 },
        { y: 24.15, x0: 20.75, n: 8, kind: "socket", h: 8.5 },
        { y: -24.1, x0: 2.55, n: 8, kind: "socket", h: 8.5 },
        { y: -24.1, x0: 22.8, n: 6, kind: "socket", h: 8.5 },
      ],
    },
  },
  look: { body: "pcb_blue", accent: "#00979d" },
  mount: {
    holes: [
      { x: 14.0 - ox, y: 2.5 - oy, d: 3.2 },
      { x: 15.3 - ox, y: 50.7 - oy, d: 3.2 },
      { x: 66.1 - ox, y: 7.6 - oy, d: 3.2 },
      { x: 66.1 - ox, y: 35.5 - oy, d: 3.2 },
    ],
    standoffHeight: 5,
  },
  ports: [
    { kind: "usb_b", face: "-x", at: { u: 0.71, v: 0.5 }, size: { w: 12.2, h: 11 } },
    { kind: "dc_jack", face: "-x", at: { u: (-18 + oy) / 53.3, v: 0.56 }, size: { w: 9.5, h: 11 } },
  ],
  pins: [
    { id: "5V", label: "5V", role: "5v", voltage: 5, side: "bottom" },
    { id: "3V3", label: "3.3V", role: "3v3", voltage: 3.3, side: "bottom" },
    { id: "VIN", label: "VIN", role: "vin", side: "bottom" },
    { id: "GND_1", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "GND_2", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "GND_3", label: "GND", role: "gnd", voltage: 0, side: "top" },
    digital(0, "uart_rx", "D0 (RX)"),
    digital(1, "uart_tx", "D1 (TX)"),
    digital(2, "gpio"),
    digital(3, "pwm", "D3 (~)"),
    digital(4, "gpio"),
    digital(5, "pwm", "D5 (~)"),
    digital(6, "pwm", "D6 (~)"),
    digital(7, "gpio"),
    digital(8, "gpio"),
    digital(9, "pwm", "D9 (~)"),
    digital(10, "pwm", "D10 (~)"),
    digital(11, "pwm", "D11 (~)"),
    digital(12, "gpio"),
    digital(13, "gpio"),
    analog(0),
    analog(1),
    analog(2),
    analog(3),
    analog(4, "i2c_sda", "A4 / SDA"),
    analog(5, "i2c_scl", "A5 / SCL"),
  ],
  power: { vMin: 5, vMax: 12, logicV: 5, mA: 50 },
  clearance: 2,
};
