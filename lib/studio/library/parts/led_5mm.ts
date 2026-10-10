import type { LibraryPart } from "../../schema";

// 5 mm indicator LED (helper). Needs a series resistor.
export const led5mm: LibraryPart = {
  id: "led_5mm",
  name: { en: "Indicator light (LED)", ar: "ضوء مؤشّر (LED)" },
  blurb: {
    en: "A small light that shows what your product is doing.",
    ar: "ضوء صغير يوضّح ما يفعله منتجك.",
  },
  category: "output",
  storeSkus: [],
  tags: ["led", "light", "indicator", "status", "lamp", "glow", "signal", "blink", "output"],
  dims: { x: 5.8, y: 5.8, z: 14.5 },
  model: { kind: "procedural", builder: "led", params: { colour: "#ff3b30" } },
  look: { body: "plastic_white", accent: "#ff3b30" },
  mount: null,
  ports: [
    { kind: "led_light_pipe", face: "+z", at: { u: 0.5, v: 0.5 }, size: { w: 5, h: 5 } },
  ],
  pins: [
    { id: "A", label: "Anode (+, long leg)", role: "in", side: "left" },
    { id: "K", label: "Cathode (-, short leg)", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 1.8, vMax: 3.3, logicV: 5, mA: 20 },
  requires: [{ id: "resistor_220", reason: "Limits the current so the light lasts." }],
  clearance: 1,
  helper: true,
};
