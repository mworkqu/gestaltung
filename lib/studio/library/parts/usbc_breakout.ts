import type { LibraryPart } from "../../schema";

// Bare USB-C receptacle on a tiny board with solder pads (VBUS, GND, D-, D+). Only VBUS and GND
// are modelled (a power-in socket); the data pads are left for a hand-wired build.
export const usbcBreakout: LibraryPart = {
  id: "usbc_breakout",
  name: { en: "USB-C socket board (power in)", ar: "لوحة مقبس USB-C (دخل الطاقة)" },
  blurb: {
    en: "A tiny board with a USB-C socket so you can plug a cable into your product.",
    ar: "لوحة صغيرة بمقبس USB-C لتوصيل كابل بمنتجك.",
  },
  category: "connector",
  storeSkus: [],
  tags: ["usb-c", "usbc", "usb", "socket", "connector", "breakout", "port", "plug", "power-in", "charging", "cable", "input"],
  dims: { x: 16, y: 12, z: 4.4 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "usbc", side: -1, y: 0 },
        { t: "box", x: 2.5, y: 3, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 2.5, y: -3, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "pads", x: 6.5, y: 0, n: 4, axis: "y", pitch: 2.6 },
      ],
    },
  },
  look: { body: "pcb_black" },
  mount: null,
  ports: [{ kind: "usb_c", face: "-x", at: { u: 0.5, v: 0.6 }, size: { w: 9.2, h: 3.4 } }],
  pins: [
    { id: "VBUS", label: "VBUS (5 V)", role: "5v", voltage: 5, side: "right" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 0 },
  clearance: 1.5,
};
