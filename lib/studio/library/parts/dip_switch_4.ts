import type { LibraryPart } from "../../schema";

// 4-position DIP switch (8 pins, 2.54 mm pitch, 7.62 mm row spacing). Switch n joins pin n to pin
// 9-n when slid ON: a row of binary inputs (A, B...) for logic circuits on a breadboard.
export const dipSwitch4: LibraryPart = {
  id: "dip_switch_4",
  name: { en: "4-position DIP switch", ar: "مفتاح DIP رباعي" },
  blurb: {
    en: "Four tiny slide switches in a row: each one sets an input to 1 or 0.",
    ar: "أربعة مفاتيح انزلاقية صغيرة في صف: كل واحد يضبط مدخلاً على 1 أو 0.",
  },
  category: "input",
  storeSkus: [],
  tags: ["dip", "dip-switch", "dipswitch", "switch", "binary", "input", "logic", "gate", "boolean", "toggle", "breadboard", "4-position", "ttl", "select"],
  dims: { x: 10.2, y: 7.9, z: 8 },
  model: { kind: "procedural", builder: "dipSwitch", params: { n: 4 } },
  look: { body: "plastic_black" },
  mount: null,
  ports: [{ kind: "button_cap", face: "+z", at: { u: 0.5, v: 0.5 }, size: { w: 9, h: 3.5 } }],
  pins: [
    { id: "1", label: "Switch 1", role: "in", side: "bottom" },
    { id: "2", label: "Switch 2", role: "in", side: "bottom" },
    { id: "3", label: "Switch 3", role: "in", side: "bottom" },
    { id: "4", label: "Switch 4", role: "in", side: "bottom" },
    { id: "5", label: "Switch 4 out", role: "out", side: "top" },
    { id: "6", label: "Switch 3 out", role: "out", side: "top" },
    { id: "7", label: "Switch 2 out", role: "out", side: "top" },
    { id: "8", label: "Switch 1 out", role: "out", side: "top" },
  ],
  power: { vMin: 0, vMax: 5, logicV: 5, mA: 0 },
  clearance: 1,
};
