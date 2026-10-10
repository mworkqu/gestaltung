import type { LibraryPart } from "../../schema";

// Small fixed 5 V step-up (boost) module, 2.5-5.5 V in, about 1 A out. NOT a battery
// (category "power", tags avoid battery/cell/lipo so the wiring never mistakes it for a cell).
// A converter to the wiring: a "vin" pin in and a "5v" pin out.
export const boost5v: LibraryPart = {
  id: "boost_5v",
  name: { en: "Battery-to-5 V booster", ar: "رافع الجهد من البطارية إلى 5 فولت" },
  blurb: {
    en: "Lifts a 3.7 V battery up to a steady 5 V for parts that need more than the battery gives.",
    ar: "يرفع جهد بطارية 3.7 فولت إلى 5 فولت ثابتة للقطع التي تحتاج أكثر مما تعطيه البطارية.",
  },
  category: "power",
  storeSkus: [],
  tags: ["boost", "5v", "step-up", "stepup", "converter", "regulator", "voltage", "mt3608", "battery-powered", "portable", "power", "upconverter"],
  dims: { x: 23, y: 12.5, z: 5.2 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1,
      r: 0.8,
      feats: [
        { t: "box", x: 2, y: 0, w: 6.6, d: 6.6, h: 4.2, c: "#3b3f46", rough: 0.55 },
        { t: "box", x: -5.5, y: 2, w: 3, d: 1.6, h: 0.9, c: "#15161a" },
        { t: "box", x: -5.5, y: -2.5, w: 2.4, d: 1.2, h: 0.8, c: "#d9b13b" },
        { t: "box", x: 8, y: 3.5, w: 3.2, d: 3.2, h: 2.2, c: "#202226", rough: 0.4 },
        { t: "led", x: -2, y: 4.5, c: "#ff3b30" },
        { t: "pads", x: -10, y: 0, n: 2, axis: "y", pitch: 5 },
        { t: "pads", x: 10, y: 0, n: 2, axis: "y", pitch: 5 },
      ],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [],
  pins: [
    { id: "VIN", label: "IN+ (battery +)", role: "vin", voltage: 3.7, side: "left" },
    { id: "GND_IN", label: "IN- (battery -)", role: "gnd", voltage: 0, side: "left" },
    { id: "OUT_5V", label: "OUT+ (5 V)", role: "5v", voltage: 5, side: "right" },
    { id: "GND_OUT", label: "OUT-", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 2.5, vMax: 5.5, logicV: 5, mA: 5 },
  clearance: 1.5,
};
