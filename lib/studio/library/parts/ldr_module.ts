import type { LibraryPart } from "../../schema";

// LM393 photoresistor (LDR) module: AO gives an analog brightness level, DO flips high/low at
// the threshold set by the blue trimmer. The LDR sits at the +x end; 4-pin header at -x.
export const ldrModule: LibraryPart = {
  id: "ldr_module",
  name: { en: "Light sensor module (dark/bright)", ar: "وحدة حسّاس ضوء (مظلم/مضيء)" },
  blurb: {
    en: "Tells your product if it is light or dark, as a level or a simple yes/no.",
    ar: "تخبر منتجك إن كان المكان مضيئاً أو مظلماً، كمستوى أو كإجابة نعم/لا.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["light", "ldr", "photoresistor", "photocell", "dark", "bright", "night", "analog", "lm393", "dusk", "streetlight", "sensor", "brightness", "daylight"],
  dims: { x: 32, y: 14, z: 11 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 0.8,
      feats: [
        { t: "cyl", x: 11.5, y: 0, r: 2.6, h: 2, c: "#d6b04a", rough: 0.4 },
        { t: "box", x: 11.5, y: 0.7, w: 3.6, d: 0.5, h: 0.04, z: 3.62, c: "#4a3a14" },
        { t: "box", x: 11.5, y: -0.7, w: 3.6, d: 0.5, h: 0.04, z: 3.62, c: "#4a3a14" },
        { t: "box", x: 1, y: 0, w: 9.5, d: 4.8, h: 6, c: "#2f5fd0", rough: 0.45 },
        { t: "box", x: -6, y: 3, w: 5, d: 4, h: 1.5, c: "#15161a" },
        { t: "led", x: -3, y: -4.5, c: "#ff3b30" },
        { t: "led", x: 4, y: -4.5, c: "#35d07f" },
      ],
      rows: [{ x: -13.5, y: 0, n: 4, axis: "y", kind: "pins" }],
    },
  },
  look: { body: "pcb_black" },
  mount: null,
  ports: [{ kind: "sensor_window", face: "+z", at: { u: 0.859, v: 0.5 }, size: { w: 6, h: 6 } }],
  pins: [
    { id: "VCC", label: "VCC (3.3-5 V)", role: "vin", side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
    { id: "DO", label: "DO (dark/bright)", role: "gpio", voltage: 3.3, side: "left" },
    { id: "AO", label: "AO (light level)", role: "out", voltage: 3.3, side: "left" },
  ],
  power: { vMin: 3.3, vMax: 5.5, logicV: 5, mA: 5 },
  clearance: 1.5,
};
