import type { LibraryPart } from "../../schema";

// Male-to-male jumper wires used to connect parts on a breadboard. Passive, no pins.
export const jumperKit: LibraryPart = {
  id: "jumper_kit",
  name: { en: "Jumper wire set (male to male)", ar: "طقم أسلاك توصيل (ذكر إلى ذكر)" },
  blurb: {
    en: "Coloured wires with a pin at each end to link parts on a breadboard.",
    ar: "أسلاك ملوّنة بدبّوس في كل طرف لتوصيل القطع على لوحة التجارب.",
  },
  category: "connector",
  storeSkus: [],
  tags: ["jumper", "wire", "wires", "male-to-male", "dupont", "breadboard", "connect", "cable", "prototype", "logic", "gate", "solderless"],
  dims: { x: 60, y: 40, z: 12 },
  model: { kind: "procedural", builder: "jumperKit", params: {} },
  look: { body: "plastic_black" },
  mount: null,
  ports: [],
  pins: [],
  power: { vMin: 0, vMax: 12, logicV: 5, mA: 0 },
  clearance: 1,
};
