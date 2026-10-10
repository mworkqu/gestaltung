import type { LibraryPart } from "../../schema";

// MP1584-style adjustable step-down (buck) module: 4.5-28 V in, trimmer sets the output
// (modelled at the common 5 V setting), up to 3 A.
export const buckConverter: LibraryPart = {
  id: "buck_converter",
  name: { en: "Voltage reducer (adjustable step-down)", ar: "مخفِّض جهد (قابل للضبط)" },
  blurb: {
    en: "Brings a higher voltage (like 9 V or 12 V) safely down to the 5 V your parts need.",
    ar: "يخفض جهداً أعلى (مثل 9 أو 12 فولت) بأمان إلى 5 فولت تحتاجها قطعك.",
  },
  category: "power",
  storeSkus: [],
  tags: ["buck", "step-down", "stepdown", "converter", "regulator", "voltage", "adjustable", "mp1584", "12v", "9v", "power", "dc", "reducer", "trimmer"],
  dims: { x: 22, y: 17, z: 4.6 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "box", x: -2, y: 1.5, w: 7.2, d: 7.2, h: 3.4, c: "#3b3f46", rough: 0.55 },
        { t: "box", x: 5.5, y: 5.5, w: 4.9, d: 3.9, h: 1.5, c: "#15161a" },
        { t: "box", x: 6.5, y: -3, w: 4, d: 4, h: 2.2, c: "#2f5fd0", rough: 0.45 },
        { t: "cyl", x: -8, y: -4.5, r: 1.8, h: 3, c: "#202226", rough: 0.4 },
        { t: "box", x: 1, y: -6, w: 3.2, d: 1.6, h: 0.8, c: "#d9b13b" },
        { t: "pads", x: -9.4, y: 0, n: 2, axis: "y", pitch: 10 },
        { t: "pads", x: 9.4, y: 0, n: 2, axis: "y", pitch: 10 },
      ],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [],
  pins: [
    { id: "IN_PLUS", label: "IN+ (4.5-28 V)", role: "vin", voltage: 12, side: "left" },
    { id: "IN_MINUS", label: "IN-", role: "gnd", voltage: 0, side: "left" },
    { id: "OUT_PLUS", label: "OUT+ (set to 5 V)", role: "5v", voltage: 5, side: "right" },
    { id: "OUT_MINUS", label: "OUT-", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 4.5, vMax: 28, logicV: 5, mA: 5 },
  clearance: 1.5,
};
