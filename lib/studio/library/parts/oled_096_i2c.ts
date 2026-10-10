import type { LibraryPart } from "../../schema";

// 0.96" 128x64 OLED, I2C (SSD1306). Pins at the -y edge, screen toward +z.
// Visible area 21.7 x 10.9 mm sits 4.2 mm above the board centre line.
export const oled096I2c: LibraryPart = {
  id: "oled_096_i2c",
  name: { en: "Small screen (0.96 inch)", ar: "شاشة صغيرة (0.96 بوصة)" },
  blurb: {
    en: "Shows text and simple pictures.",
    ar: "تعرض نصوصاً وصوراً بسيطة.",
  },
  category: "display",
  storeSkus: [],
  tags: ["display", "screen", "oled", "ssd1306", "i2c", "text", "graphics", "small", "0.96", "monitor", "readout"],
  dims: { x: 27.3, y: 27.8, z: 4 },
  model: { kind: "procedural", builder: "oledDisplay", params: {} },
  look: { body: "pcb_blue" },
  mount: {
    holes: [
      { x: -11.65, y: -11.9, d: 2 },
      { x: 11.65, y: -11.9, d: 2 },
      { x: -11.65, y: 11.9, d: 2 },
      { x: 11.65, y: 11.9, d: 2 },
    ],
    standoffHeight: 3,
  },
  ports: [
    { kind: "display_window", face: "+z", at: { u: 0.5, v: 0.65 }, size: { w: 22, h: 11 } },
  ],
  pins: [
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "VCC", label: "VCC (3.3-5 V)", role: "3v3", voltage: 3.3, side: "bottom" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 3.3, side: "bottom" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 3.3, side: "bottom" },
  ],
  power: { vMin: 3.0, vMax: 5.5, logicV: 3.3, mA: 20 },
  clearance: 1.5,
};
