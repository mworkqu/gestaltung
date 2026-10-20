import type { LibraryPart } from "../../schema";

// 7404 (NOT) in a 14-pin DIP, 5 V TTL/HCT. Standard 7400-series pinout: pin 7 = GND, pin 14 = VCC.
// Not wired to a microcontroller: it sits on a breadboard, driven by switches / LEDs.
export const ic7404: LibraryPart = {
  id: "ic_7404",
  name: { en: "NOT gate chip (7404)", ar: "شريحة بوابة NOT (7404)" },
  blurb: {
    en: "Six inverters in one chip: each output is the opposite of its input.",
    ar: "ست بوابات عاكسة في شريحة واحدة: كل خرج هو عكس مدخله.",
  },
  category: "logic",
  storeSkus: [],
  tags: ["logic","gate","ttl","ic","chip","dip","dip14","digital","boolean","74xx","7400-series","5v","7404","not","inverter","74hc04","invert","breadboard"],
  dims: { x: 19.3, y: 7.9, z: 7.2 },
  model: { kind: "procedural", builder: "dipChip", params: { pins: 14, label: "7404" } },
  look: { body: "plastic_black" },
  mount: null,
  ports: [],
  pins: [
    { id: "1", label: "1A (input)", role: "in", side: "bottom" },
    { id: "2", label: "1Y (output)", role: "out", side: "bottom" },
    { id: "3", label: "2A (input)", role: "in", side: "bottom" },
    { id: "4", label: "2Y (output)", role: "out", side: "bottom" },
    { id: "5", label: "3A (input)", role: "in", side: "bottom" },
    { id: "6", label: "3Y (output)", role: "out", side: "bottom" },
    { id: "7", label: "GND", role: "gnd", side: "bottom", voltage: 0 },
    { id: "8", label: "4Y (output)", role: "out", side: "top" },
    { id: "9", label: "4A (input)", role: "in", side: "top" },
    { id: "10", label: "5Y (output)", role: "out", side: "top" },
    { id: "11", label: "5A (input)", role: "in", side: "top" },
    { id: "12", label: "6Y (output)", role: "out", side: "top" },
    { id: "13", label: "6A (input)", role: "in", side: "top" },
    { id: "14", label: "VCC (5 V)", role: "5v", side: "top", voltage: 5 },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 15 },
  clearance: 1,
};
