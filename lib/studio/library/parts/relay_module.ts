import type { LibraryPart } from "../../schema";

// 1-channel 5 V relay module (SRD-05VDC-SL-C relay, opto-isolator and driver transistor on the
// board). The tags "module" + "driver" + "relay_module" make the wiring treat it as a ready-made
// switch, never as a bare relay coil. The mains-side screw terminals (COM / NO / NC) are on the
// +x edge and are not wired by the circuit (they switch your lamp, pump or heater).
export const relayModule: LibraryPart = {
  id: "relay_module",
  name: { en: "Relay switch module (1 channel, 5 V)", ar: "وحدة مرحّل تبديل (قناة واحدة، 5 فولت)" },
  blurb: {
    en: "Lets a small board safely switch a bigger load on and off, like a lamp, pump or heater.",
    ar: "تتيح للوحة صغيرة تشغيل وإطفاء حمل أكبر بأمان، مثل المصباح أو المضخة أو السخّان.",
  },
  category: "actuator",
  storeSkus: [],
  tags: ["relay", "module", "driver", "relay_module", "switch", "mains", "high-power", "lamp", "light", "pump", "heater", "fan", "appliance", "on-off", "230v", "5v", "actuator", "smart-plug", "irrigation", "valve"],
  dims: { x: 50.5, y: 26, z: 17.1 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 1,
      feats: [
        { t: "box", x: -2, y: 0, w: 19, d: 15.5, h: 15.5, c: "#2a5db0", rough: 0.45 },
        { t: "box", x: -2, y: 0, w: 12, d: 7, h: 0.05, z: 17.05, c: "#e8eefb", rough: 0.6 },
        { t: "screw", x: 19.5, y: 0, n: 3, axis: "y", pitch: 5.08, h: 10 },
        { t: "box", x: 12, y: 7, w: 6.5, d: 4.5, h: 3.3, c: "#15161a" },
        { t: "box", x: 12, y: -6, w: 3, d: 2.6, h: 1.2, c: "#15161a" },
        { t: "box", x: 15, y: -9.5, w: 3.4, d: 1.8, h: 1.2, c: "#15161a" },
        { t: "box", x: 6, y: 10, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 6, y: -10, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: 8, y: 11, c: "#ff3b30" },
        { t: "led", x: 11, y: 11, c: "#35d07f" },
      ],
      rows: [{ x: -23, y: 0, n: 3, axis: "y", kind: "pins", tip: 9.5 }],
    },
  },
  look: { body: "pcb_blue" },
  mount: {
    holes: [
      { x: -22, y: -10.5, d: 3.1 },
      { x: -22, y: 10.5, d: 3.1 },
    ],
    standoffHeight: 4,
  },
  ports: [],
  pins: [
    { id: "VCC", label: "VCC (5 V)", role: "5v", voltage: 5, side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
    { id: "IN", label: "IN (switch signal)", role: "in", voltage: 3.3, side: "left" },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 75 },
  clearance: 3,
};
