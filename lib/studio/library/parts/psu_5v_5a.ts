import type { LibraryPart } from "../../schema";

// Wall adapter, 100-240 V AC in, 5 V DC out through a 5.5 x 2.1 mm barrel plug, rated 5 A (25 W). The part
// exposes the supply's + and - directly as pins OUT_5V / GND (same ids as usbc_power_5v), so no separate
// barrel-jack part is needed. `power.mA` stays 0 (a source, not a load); the 5 A rating is `power.supplyMA`.
export const psu5v5a: LibraryPart = {
  id: "psu_5v_5a",
  name: { en: "Wall power adapter (5 V, 5 A)", ar: "محوّل طاقة للحائط (5 فولت، 5 أمبير)" },
  blurb: {
    en: "A strong 5 V wall plug supply for products with motors or several servos.",
    ar: "مزوّد طاقة قوي 5 فولت للمقبس الحائطي للمنتجات ذات المحركات أو عدة سيرفو.",
  },
  category: "power",
  storeSkus: ["VLT-50223536570685"],
  tags: ["power", "supply", "5v", "5a", "plug", "wall", "adapter", "mains", "barrel", "dc_jack", "high_current", "servo", "motor", "always-on", "desk"],
  dims: { x: 70, y: 40, z: 30 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 30,
      boardW: 62,
      boardX: -4,
      r: 3,
      feats: [
        { t: "box", x: -4, y: 0, w: 20, d: 12, h: 0.3, c: "#2a2a2e" },
        { t: "led", x: 12, y: 12, c: "#35d07f" },
        { t: "box", x: 31, y: 0, w: 8, d: 5.5, h: 5.5, z: 12, m: "metal" },
      ],
    },
  },
  look: { body: "plastic_black" },
  mount: null,
  ports: [],
  pins: [
    { id: "OUT_5V", label: "5V out (+, barrel centre)", role: "5v", voltage: 5, side: "right" },
    { id: "GND", label: "GND (barrel sleeve)", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 4.75, vMax: 5.25, logicV: 5, mA: 0, supplyMA: 5000 },
  clearance: 5,
};
