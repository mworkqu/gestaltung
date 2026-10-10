import type { LibraryPart } from "../../schema";

// 220 ohm 1/4 W axial resistor (helper), bands red-red-brown-gold. No openings.
export const resistor220: LibraryPart = {
  id: "resistor_220",
  name: { en: "Current-limiting resistor (220 ohm)", ar: "مقاومة تحدّ من التيار (220 أوم)" },
  blurb: {
    en: "Protects a light so it does not burn out.",
    ar: "تحمي الضوء كي لا يحترق.",
  },
  category: "power",
  storeSkus: [],
  tags: ["resistor", "220", "ohm", "protection", "led", "current"],
  dims: { x: 10.8, y: 2.4, z: 6.4 },
  model: { kind: "procedural", builder: "resistor", params: { bands: ["#c0392b", "#c0392b", "#6e3b1c", "#c9a227"] } },
  look: { body: "plastic_white" },
  mount: null,
  ports: [],
  pins: [
    { id: "1", label: "End 1", role: "in", side: "left" },
    { id: "2", label: "End 2", role: "out", side: "right" },
  ],
  power: { vMin: 0, vMax: 5, logicV: 5, mA: 0 },
  clearance: 1,
  helper: true,
};
