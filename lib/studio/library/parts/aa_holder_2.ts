import type { LibraryPart } from "../../schema";

// 2 x AA battery holder (cells side by side, in series): about 3 V (2 x 1.5 V alkaline,
// 2.0-3.2 V over the cell's life). Cell axis = X.
export const aaHolder2: LibraryPart = {
  id: "aa_holder_2",
  name: { en: "2 x AA battery holder (3 V)", ar: "حامل بطاريتين AA (3 فولت)" },
  blurb: {
    en: "Holds two ordinary AA batteries to power your product without a plug.",
    ar: "يحمل بطاريتين AA عاديتين لتشغيل منتجك دون وصلة كهرباء.",
  },
  category: "power",
  storeSkus: [],
  tags: ["battery", "aa", "alkaline", "holder", "cordless", "portable", "power", "3v", "disposable", "toy", "remote", "low-power"],
  dims: { x: 58, y: 32, z: 15.5 },
  model: { kind: "procedural", builder: "aaHolder", params: {} },
  look: { body: "battery_wrap" },
  mount: null,
  ports: [],
  pins: [
    { id: "BAT_PLUS", label: "Battery + (red wire)", role: "out", voltage: 3, side: "right" },
    { id: "BAT_MINUS", label: "Battery - (black wire)", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 2, vMax: 3.2, logicV: 3.3, mA: 0 },
  clearance: 1.5,
};
