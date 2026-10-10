import type { LibraryPart } from "../../schema";

// 18650 Li-ion cell (18.6 x 65 mm) in a single-cell holder. Cell axis = X.
export const cell18650: LibraryPart = {
  id: "cell_18650",
  name: { en: "Rechargeable battery (18650) with holder", ar: "بطارية قابلة للشحن (18650) مع حامل" },
  blurb: {
    en: "Stores power so your product works without a plug.",
    ar: "تخزّن الطاقة ليعمل منتجك دون وصلة كهرباء.",
  },
  category: "power",
  storeSkus: [],
  tags: ["battery", "18650", "li-ion", "lithium", "rechargeable", "cordless", "portable", "power", "3.7v", "holder"],
  dims: { x: 76, y: 22, z: 19.5 },
  model: { kind: "procedural", builder: "battery18650", params: {} },
  look: { body: "battery_wrap" },
  mount: null,
  ports: [],
  pins: [
    { id: "BAT_PLUS", label: "Battery +", role: "out", voltage: 3.7, side: "right" },
    { id: "BAT_MINUS", label: "Battery -", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3.0, vMax: 4.2, logicV: 3.3, mA: 0 },
  clearance: 1.5,
};
