import type { LibraryPart } from "../../schema";

// TP4056 1 A Li-ion charger with protection, USB-C input at the -x end.
export const tp4056Usbc: LibraryPart = {
  id: "tp4056_usbc",
  name: { en: "USB-C battery charger board", ar: "لوحة شحن البطارية عبر USB-C" },
  blurb: {
    en: "Charges the battery safely from any USB-C cable.",
    ar: "تشحن البطارية بأمان من أي كابل USB-C.",
  },
  category: "power",
  storeSkus: [],
  tags: ["charger", "tp4056", "usb-c", "usbc", "battery", "charging", "li-ion", "lithium", "protection", "rechargeable"],
  dims: { x: 26, y: 17, z: 4.4 },
  model: { kind: "procedural", builder: "chargerBoard", params: {} },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [
    { kind: "usb_c", face: "-x", at: { u: 0.5, v: 0.6 }, size: { w: 9.2, h: 3.4 } },
  ],
  pins: [
    { id: "IN_PLUS", label: "IN+ (USB 5V)", role: "vin", voltage: 5, side: "left" },
    { id: "IN_MINUS", label: "IN-", role: "gnd", voltage: 0, side: "left" },
    { id: "OUT_PLUS", label: "OUT+ (to your circuit)", role: "out", voltage: 3.7, side: "right" },
    { id: "OUT_MINUS", label: "OUT-", role: "gnd", voltage: 0, side: "right" },
    { id: "B_PLUS", label: "B+ (battery +)", role: "in", voltage: 3.7, side: "right" },
    { id: "B_MINUS", label: "B- (battery -)", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 4.0, vMax: 8, logicV: 5, mA: 1000 },
  clearance: 1.5,
};
