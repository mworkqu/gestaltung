import type { LibraryPart } from "../../schema";

// 4-channel bidirectional logic level shifter (BSS138): LV side 3.3 V, HV side 5 V. Helper part,
// added by the wiring where a 5 V signal would reach a 3.3 V board (and back). Channel pairs are
// LV1-HV1 ... LV4-HV4.
export const levelShifter4ch: LibraryPart = {
  id: "level_shifter_4ch",
  name: { en: "Voltage translator (4 channels, 3.3 V <-> 5 V)", ar: "مترجم جهد (4 قنوات، 3.3 فولت <-> 5 فولت)" },
  blurb: {
    en: "Lets a 5 V part and a 3.3 V board talk to each other without damage.",
    ar: "يتيح لقطعة 5 فولت ولوحة 3.3 فولت التخاطب دون تلف.",
  },
  category: "connector",
  storeSkus: [],
  tags: ["level_shifter", "level-shifter", "shifter", "logic-level", "converter", "voltage", "translator", "bss138", "3.3v", "5v", "bidirectional", "i2c", "protection"],
  dims: { x: 16, y: 13, z: 8.5 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "box", x: -4.5, y: 0, w: 2.9, d: 1.3, h: 1, c: "#15161a" },
        { t: "box", x: -1.5, y: 0, w: 2.9, d: 1.3, h: 1, c: "#15161a" },
        { t: "box", x: 1.5, y: 0, w: 2.9, d: 1.3, h: 1, c: "#15161a" },
        { t: "box", x: 4.5, y: 0, w: 2.9, d: 1.3, h: 1, c: "#15161a" },
        { t: "box", x: -3, y: 2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 3, y: -2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
      ],
      rows: [
        { x: 0, y: -5, n: 6, kind: "pins" },
        { x: 0, y: 5, n: 6, kind: "pins" },
      ],
    },
  },
  look: { body: "pcb_black" },
  mount: null,
  ports: [],
  pins: [
    { id: "LV1", label: "LV1", role: "gpio", voltage: 3.3, side: "left" },
    { id: "LV2", label: "LV2", role: "gpio", voltage: 3.3, side: "left" },
    { id: "LV", label: "LV (3.3 V)", role: "3v3", voltage: 3.3, side: "left" },
    { id: "GND_L", label: "GND", role: "gnd", voltage: 0, side: "left" },
    { id: "LV3", label: "LV3", role: "gpio", voltage: 3.3, side: "left" },
    { id: "LV4", label: "LV4", role: "gpio", voltage: 3.3, side: "left" },
    { id: "HV1", label: "HV1", role: "gpio", voltage: 5, side: "right" },
    { id: "HV2", label: "HV2", role: "gpio", voltage: 5, side: "right" },
    { id: "HV", label: "HV (5 V)", role: "5v", voltage: 5, side: "right" },
    { id: "GND_H", label: "GND", role: "gnd", voltage: 0, side: "right" },
    { id: "HV3", label: "HV3", role: "gpio", voltage: 5, side: "right" },
    { id: "HV4", label: "HV4", role: "gpio", voltage: 5, side: "right" },
  ],
  power: { vMin: 1.8, vMax: 5.5, logicV: 3.3, mA: 0.1 },
  clearance: 1,
  helper: true,
};
