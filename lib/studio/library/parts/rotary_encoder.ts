import type { LibraryPart } from "../../schema";

// KY-040 rotary encoder: a knob that clicks round in steps (CLK/DT) and presses (SW). Board pull-ups
// are fitted. The knob (15 mm) is the +z button_cap port; 5-pin header at the -x edge.
export const rotaryEncoder: LibraryPart = {
  id: "rotary_encoder",
  name: { en: "Turn knob (rotary encoder)", ar: "مقبض دوّار (إنكودر)" },
  blurb: {
    en: "A knob you turn to change a value, and press to confirm.",
    ar: "مقبض تديره لتغيير قيمة وتضغط عليه للتأكيد.",
  },
  category: "input",
  storeSkus: [],
  tags: ["knob", "encoder", "rotary", "ky-040", "dial", "turn", "volume", "menu", "scroll", "select", "input", "control", "settings", "click", "adjust"],
  dims: { x: 26.5, y: 19.5, z: 30 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 1,
      feats: [
        { t: "box", x: 2, y: 0, w: 12, d: 12, h: 6.5, m: "metal" },
        { t: "cyl", x: 2, y: 0, r: 3.5, h: 7, z: 8.1, m: "metal" },
        { t: "cyl", x: 2, y: 0, r: 3, h: 1.9, z: 15.1, m: "metal" },
        { t: "cyl", x: 2, y: 0, r: 7.8, h: 1.5, z: 17, c: "#17181b", rough: 0.5, seg: 28 },
        { t: "cyl", x: 2, y: 0, r: 7.2, h: 11.1, z: 18.5, c: "#17181b", rough: 0.5, seg: 28 },
        { t: "cyl", x: 2, y: 0, r: 6.4, h: 0.4, z: 29.6, m: "metal", seg: 28 },
        { t: "box", x: -4, y: 5.5, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: -4, y: 0, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: -4, y: -5.5, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
      ],
      rows: [{ x: -11.5, y: 0, n: 5, axis: "y", kind: "pins", tip: 11 }],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [{ kind: "button_cap", face: "+z", at: { u: 0.5755, v: 0.5 }, size: { w: 16, h: 16 } }],
  pins: [
    { id: "CLK", label: "CLK (turn A)", role: "out", voltage: 5, side: "left" },
    { id: "DT", label: "DT (turn B)", role: "out", voltage: 5, side: "left" },
    { id: "SW", label: "SW (press)", role: "out", voltage: 5, side: "left" },
    { id: "VCC", label: "+ (3.3-5 V)", role: "vin", side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3.3, vMax: 5.5, logicV: 5, mA: 1 },
  clearance: 2,
};
