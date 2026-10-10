import type { LibraryPart } from "../../schema";

// DS3231 real-time clock module (ZS-042 style), I2C, with a CR2032 coin cell that keeps the time
// while the product is off. Accurate to about a minute a year. 6-pin header at the -x edge.
export const rtcDs3231: LibraryPart = {
  id: "rtc_ds3231",
  name: { en: "Clock module (keeps time when off)", ar: "وحدة ساعة (تحفظ الوقت عند الإطفاء)" },
  blurb: {
    en: "Remembers the exact date and time, even when your product is switched off.",
    ar: "تتذكّر التاريخ والوقت بدقة حتى عند إطفاء منتجك.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["clock", "rtc", "ds3231", "time", "date", "timer", "schedule", "alarm", "i2c", "logger", "datalogger", "timestamp", "coin-cell", "calendar"],
  dims: { x: 38, y: 22, z: 11 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 1,
      feats: [
        { t: "cyl", x: 8, y: 0, r: 10.8, h: 1.6, c: "#17181b", rough: 0.5, seg: 28 },
        { t: "cyl", x: 8, y: 0, r: 10, h: 3.2, z: 3.2, m: "metal", seg: 28 },
        { t: "box", x: -7, y: 4.5, w: 10.3, d: 7.5, h: 2.5, c: "#15161a" },
        { t: "box", x: -7, y: -4.5, w: 5, d: 4, h: 1.5, c: "#15161a" },
        { t: "box", x: -11, y: 0, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: -12.5, y: -8, c: "#ff3b30" },
      ],
      rows: [{ x: -17, y: 0, n: 6, axis: "y", kind: "pins" }],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [],
  pins: [
    { id: "VCC", label: "VCC (3.3-5.5 V)", role: "vin", side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 3.3, side: "left" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 3.3, side: "left" },
  ],
  power: { vMin: 3.3, vMax: 5.5, logicV: 5, mA: 2 },
  clearance: 1.5,
};
