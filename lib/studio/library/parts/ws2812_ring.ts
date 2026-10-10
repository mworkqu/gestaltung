import type { LibraryPart } from "../../schema";

// 12-LED WS2812 RGB ring, 37 mm across. One data wire (DIN) drives all 12 pixels; 5 V supply.
// Peak draw is 12 x 60 mA = 720 mA (all white, full brightness); mA below is a typical ~half
// brightness figure. There is no ring-shaped window kind: the display_window is the 37 x 37 mm
// square around the ring (the enclosure cut-out is a round opening of that size).
export const ws2812Ring: LibraryPart = {
  id: "ws2812_ring",
  name: { en: "Colour light ring (12 LEDs)", ar: "حلقة إضاءة ملوّنة (12 مصباح LED)" },
  blurb: {
    en: "A ring of 12 colour lights you can set to any colour, one by one.",
    ar: "حلقة من 12 ضوءاً ملوّناً يمكنك ضبط كل واحد منها على أي لون.",
  },
  category: "output",
  storeSkus: [],
  tags: ["led", "leds", "ring", "neopixel", "ws2812", "rgb", "light", "lamp", "colour", "color", "indicator", "status", "glow", "mood", "animation", "addressable", "5v", "clock", "decor"],
  dims: { x: 37, y: 37, z: 3.2 },
  model: { kind: "procedural", builder: "ledRing", params: { leds: 12, innerR: 11.6 } },
  look: { body: "pcb_black" },
  mount: null,
  ports: [{ kind: "display_window", face: "+z", at: { u: 0.5, v: 0.5 }, size: { w: 37, h: 37 } }],
  pins: [
    { id: "VCC", label: "5V", role: "5v", voltage: 5, side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "DIN", label: "DIN (data in)", role: "in", voltage: 3.3, side: "bottom" },
  ],
  power: { vMin: 3.5, vMax: 5.3, logicV: 5, mA: 360 },
  clearance: 1.5,
};
