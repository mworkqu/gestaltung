import type { LibraryPart } from "../../schema";

// 16 x 2 character LCD (1602) with an I2C backpack soldered on the back. 80 x 36 mm board, blue
// backlight, 5 V only; I2C pull-ups sit at 5 V, so a 3.3 V board gets a level shifter. The backpack
// is under the board, so the board floats 4.2 mm above the plane (use standoffs of that height).
export const lcd1602I2c: LibraryPart = {
  id: "lcd1602_i2c",
  name: { en: "Text screen (16 x 2 characters)", ar: "شاشة نصية (16 × 2 حرفاً)" },
  blurb: {
    en: "A classic backlit screen that shows two lines of 16 letters or numbers.",
    ar: "شاشة كلاسيكية مضاءة تعرض سطرين من 16 حرفاً أو رقماً.",
  },
  category: "display",
  storeSkus: [],
  tags: ["display", "screen", "lcd", "lcd1602", "1602", "16x2", "text", "characters", "i2c", "backlight", "monitor", "readout", "5v", "menu", "status"],
  dims: { x: 80, y: 36, z: 12.2 },
  model: { kind: "procedural", builder: "lcdModule", params: { backH: 4.2 } },
  look: { body: "pcb_green" },
  mount: {
    holes: [
      { x: -37.5, y: -15.5, d: 2.5 },
      { x: 37.5, y: -15.5, d: 2.5 },
      { x: -37.5, y: 15.5, d: 2.5 },
      { x: 37.5, y: 15.5, d: 2.5 },
    ],
    standoffHeight: 4.2,
  },
  ports: [{ kind: "display_window", face: "+z", at: { u: 0.5, v: 0.472 }, size: { w: 64.5, h: 16 } }],
  pins: [
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "VCC", label: "VCC (5 V)", role: "5v", voltage: 5, side: "bottom" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 5, side: "bottom" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 5, side: "bottom" },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 30 },
  clearance: 2,
};
