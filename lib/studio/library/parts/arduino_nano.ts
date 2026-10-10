import type { LibraryPart, Pin, PinRole } from "../../schema";

// Arduino Nano (ATmega328P): 43.2 x 17.8 mm, 5 V logic, 2 x 15 pin rows.
// The classic Nano has a MINI-USB socket; the library has no mini kind, so the port is
// declared as usb_micro (closest size: 8.2 x 4.2 mm opening).
type Row = [string, string, PinRole, number?];
const d = (n: number, role: PinRole = "gpio", label = `D${n}`): Row => [`D${n}`, label, role, 5];
const a = (n: number, role: PinRole = "adc", label = `A${n}`): Row => [`A${n}`, label, role, 5];
// -y row (left), from the USB end: VIN GND 5V A7..A0 3V3 D13
const L: Row[] = [
  ["VIN", "VIN", "vin"],
  ["GND_1", "GND", "gnd", 0],
  ["5V", "5V", "5v", 5],
  a(7), a(6),
  a(5, "i2c_scl", "A5 / SCL"),
  a(4, "i2c_sda", "A4 / SDA"),
  a(3), a(2), a(1), a(0),
  ["3V3", "3.3V", "3v3", 3.3],
  d(13, "spi_sck", "D13 (SCK)"),
];
// +y row (right), from the USB end: TX1 RX0 GND D2..D12
const R: Row[] = [
  d(1, "uart_tx", "D1 (TX)"),
  d(0, "uart_rx", "D0 (RX)"),
  ["GND_2", "GND", "gnd", 0],
  d(2),
  d(3, "pwm", "D3 (~)"),
  d(4),
  d(5, "pwm", "D5 (~)"),
  d(6, "pwm", "D6 (~)"),
  d(7), d(8),
  d(9, "pwm", "D9 (~)"),
  d(10, "spi_cs", "D10 (CS)"),
  d(11, "spi_mosi", "D11 (MOSI)"),
  d(12, "spi_miso", "D12 (MISO)"),
];
const toPins = (rows: Row[], side: Pin["side"]): Pin[] =>
  rows.map(([id, label, role, voltage]) => ({ id, label, role, voltage, side }));

export const arduinoNano: LibraryPart = {
  id: "arduino_nano",
  name: { en: "Arduino Nano brain board", ar: "لوحة التحكم أردوينو نانو" },
  blurb: {
    en: "A tiny beginner-friendly board that reads sensors and switches things on and off.",
    ar: "لوحة صغيرة سهلة للمبتدئين تقرأ الحسّاسات وتشغّل الأشياء وتطفئها.",
  },
  category: "mcu",
  storeSkus: [],
  tags: ["arduino", "nano", "atmega328", "microcontroller", "brain", "controller", "beginner", "5v", "prototype", "learning", "small", "compact", "breadboard"],
  dims: { x: 43.2, y: 17.8, z: 9 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 1,
      feats: [
        { t: "mini", side: -1, y: 0 },
        { t: "box", x: 4, y: 0, w: 7, d: 7, h: 1.2, c: "#15161a" },
        { t: "box", x: -6, y: 2.5, w: 9.9, d: 4, h: 1.5, c: "#15161a" },
        { t: "box", x: -2.5, y: -3, w: 3.4, d: 2.6, h: 1.2, m: "metal" },
        { t: "box", x: -7, y: -3.5, w: 4, d: 4, h: 2, c: "#d8d8d8", rough: 0.4, metalness: 0.5 },
        { t: "box", x: 14.5, y: 3, w: 6.5, d: 3.5, h: 1.6, c: "#15161a" },
        { t: "led", x: 12, y: -3.5, c: "#35d07f" },
        { t: "led", x: 12, y: -1.5, c: "#ffb020" },
      ],
      rows: [
        { x: 0, y: -7.62, n: 15, kind: "pins" },
        { x: 0, y: 7.62, n: 15, kind: "pins" },
      ],
    },
  },
  look: { body: "pcb_blue", accent: "#00979d" },
  mount: null,
  ports: [{ kind: "usb_micro", face: "-x", at: { u: 0.5, v: 0.39 }, size: { w: 8.2, h: 4.2 } }],
  pins: [...toPins(L, "left"), ...toPins(R, "right")],
  power: { vMin: 7, vMax: 12, logicV: 5, mA: 40 },
  clearance: 2,
};
