import type { LibraryPart } from "../../schema";

// 1.3" 128x64 OLED, I2C (SH1106). 35.4 x 33.5 mm board, pins at the -y edge, screen toward +z.
// Visible area 29.4 x 14.7 mm sits 3 mm above the board centre line.
export const oled13I2c: LibraryPart = {
  id: "oled_13_i2c",
  name: { en: "Screen (1.3 inch)", ar: "شاشة (1.3 بوصة)" },
  blurb: {
    en: "A bigger, sharper screen for text, numbers and simple pictures.",
    ar: "شاشة أكبر وأوضح للنصوص والأرقام والصور البسيطة.",
  },
  category: "display",
  storeSkus: [],
  tags: ["display", "screen", "oled", "sh1106", "ssd1306", "i2c", "text", "graphics", "1.3", "monitor", "readout", "large", "dashboard", "clock"],
  dims: { x: 35.4, y: 33.5, z: 4 },
  model: {
    kind: "procedural",
    builder: "oledDisplay",
    params: { glassW: 32, glassH: 23, glassY: 1.5, activeW: 29.4, activeH: 14.7, activeDY: 1.5 },
  },
  look: { body: "pcb_blue" },
  mount: {
    holes: [
      { x: -16.2, y: -14.9, d: 2 },
      { x: 16.2, y: -14.9, d: 2 },
      { x: -16.2, y: 14.9, d: 2 },
      { x: 16.2, y: 14.9, d: 2 },
    ],
    standoffHeight: 3,
  },
  ports: [{ kind: "display_window", face: "+z", at: { u: 0.5, v: 0.5896 }, size: { w: 29.5, h: 14.8 } }],
  pins: [
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "VCC", label: "VCC (3.3-5 V)", role: "3v3", voltage: 3.3, side: "bottom" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 3.3, side: "bottom" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 3.3, side: "bottom" },
  ],
  power: { vMin: 3.0, vMax: 5.5, logicV: 3.3, mA: 25 },
  clearance: 1.5,
};
