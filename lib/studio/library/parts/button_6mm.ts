import type { LibraryPart } from "../../schema";

// 6 x 6 mm tactile switch: 4 legs (two joined pairs) = one contact A/B.
export const button6mm: LibraryPart = {
  id: "button_6mm",
  name: { en: "Push button", ar: "زرّ ضغط" },
  blurb: {
    en: "Press it to tell your product to do something.",
    ar: "اضغط عليه ليبدأ منتجك بتنفيذ أمر ما.",
  },
  category: "input",
  storeSkus: [],
  tags: ["button", "switch", "push", "press", "tactile", "input", "click", "trigger", "start", "reset", "control"],
  dims: { x: 6, y: 6, z: 8 },
  model: { kind: "procedural", builder: "pushButton", params: { cap: "#3a3d44" } },
  look: { body: "plastic_black" },
  mount: null,
  ports: [
    { kind: "button_cap", face: "+z", at: { u: 0.5, v: 0.5 }, size: { w: 3.5, h: 3.5 } },
  ],
  pins: [
    { id: "A", label: "Side A", role: "in", side: "left" },
    { id: "B", label: "Side B", role: "out", side: "right" },
  ],
  power: { vMin: 0, vMax: 5, logicV: 5, mA: 0 },
  clearance: 1,
};
