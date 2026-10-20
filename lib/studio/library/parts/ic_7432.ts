import type { LibraryPart } from "../../schema";

// 7432 (OR) in a 14-pin DIP, 5 V TTL/HCT. Standard 7400-series pinout: pin 7 = GND, pin 14 = VCC.
// Not wired to a microcontroller: it sits on a breadboard, driven by switches / LEDs.
export const ic7432: LibraryPart = {
  id: "ic_7432",
  name: { en: "OR gate chip (7432)", ar: "شريحة بوابة OR (7432)" },
  blurb: {
    en: "Four 2-input OR gates in one chip: the output is high when either input is high.",
    ar: "أربع بوابات OR بمدخلين في شريحة واحدة: يكون الخرج مرتفعاً عندما يكون أي مدخل مرتفعاً.",
  },
  category: "logic",
  storeSkus: [],
  tags: ["logic","gate","ttl","ic","chip","dip","dip14","digital","boolean","74xx","7400-series","5v","7432","or","74hc32","breadboard"],
  dims: { x: 19.3, y: 7.9, z: 7.2 },
  model: { kind: "procedural", builder: "dipChip", params: { pins: 14, label: "7432" } },
  look: { body: "plastic_black" },
  mount: null,
  ports: [],
  pins: [
    { id: "1", label: "1A (input)", role: "in", side: "bottom" },
    { id: "2", label: "1B (input)", role: "in", side: "bottom" },
    { id: "3", label: "1Y (output)", role: "out", side: "bottom" },
    { id: "4", label: "2A (input)", role: "in", side: "bottom" },
    { id: "5", label: "2B (input)", role: "in", side: "bottom" },
    { id: "6", label: "2Y (output)", role: "out", side: "bottom" },
    { id: "7", label: "GND", role: "gnd", side: "bottom", voltage: 0 },
    { id: "8", label: "3Y (output)", role: "out", side: "top" },
    { id: "9", label: "3A (input)", role: "in", side: "top" },
    { id: "10", label: "3B (input)", role: "in", side: "top" },
    { id: "11", label: "4Y (output)", role: "out", side: "top" },
    { id: "12", label: "4A (input)", role: "in", side: "top" },
    { id: "13", label: "4B (input)", role: "in", side: "top" },
    { id: "14", label: "VCC (5 V)", role: "5v", side: "top", voltage: 5 },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 15 },
  clearance: 1,
};
