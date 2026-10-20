import type { LibraryPart } from "../../schema";

// Standard 830-tie-point solderless breadboard (165 x 55 mm). No microcontroller needed: parts and
// jumper wires just push in. Pins are the two power rails.
export const breadboard830: LibraryPart = {
  id: "breadboard_830",
  name: { en: "Breadboard (830 points)", ar: "لوحة تجارب (830 نقطة)" },
  blurb: {
    en: "A solderless board where you push parts and wires in to build a circuit, no soldering.",
    ar: "لوحة تجارب تغرس فيها القطع والأسلاك لبناء الدارة دون لحام.",
  },
  category: "connector",
  storeSkus: [],
  tags: ["breadboard", "prototype", "prototyping", "solderless", "830", "board", "logic", "gate", "ttl", "dip", "jumper", "learning", "education", "demo", "no-solder"],
  dims: { x: 165.1, y: 54.6, z: 8.5 },
  model: { kind: "procedural", builder: "breadboard", params: {} },
  look: { body: "plastic_white" },
  mount: null,
  ports: [],
  pins: [
    { id: "RAIL_POS", label: "Power rail (+)", role: "5v", side: "top", voltage: 5 },
    { id: "RAIL_NEG", label: "Power rail (-)", role: "gnd", side: "top", voltage: 0 },
  ],
  power: { vMin: 0, vMax: 12, logicV: 5, mA: 0 },
  clearance: 1,
};
