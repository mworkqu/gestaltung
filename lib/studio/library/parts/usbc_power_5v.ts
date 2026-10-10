import type { LibraryPart } from "../../schema";

// USB-C power board: USB-C socket (5.1 k resistors on CC, so any charger gives 5 V),
// a resettable fuse, a power LED and two output pads. Netlist note: pin "5V_OUT" has the
// role "5v" (a supply the wiring treats as a rail load today).
export const usbcPower5v: LibraryPart = {
  id: "usbc_power_5v",
  name: { en: "USB-C power socket (5 V)", ar: "مقبس طاقة USB-C (5 فولت)" },
  blurb: {
    en: "A USB-C socket that gives your product clean 5 V from any phone charger.",
    ar: "مقبس USB-C يمنح منتجك 5 فولت نظيفة من أي شاحن هاتف.",
  },
  category: "power",
  storeSkus: [],
  tags: ["usb-c", "usbc", "power", "supply", "5v", "plug", "wall", "adapter", "mains", "socket", "usb_power", "desk", "always-on", "fuse"],
  dims: { x: 20, y: 15, z: 4.4 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "usbc", side: -1, y: 0 },
        { t: "box", x: 1.5, y: 3.5, w: 3.2, d: 1.6, h: 0.9, c: "#d9b13b" },
        { t: "box", x: 2.5, y: -3, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 4.5, y: -3, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: 5, y: 4.5, c: "#ff3b30" },
        { t: "pads", x: 7.6, y: 0, n: 2, axis: "y", pitch: 4.2 },
      ],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [{ kind: "usb_c", face: "-x", at: { u: 0.5, v: 0.6 }, size: { w: 9.2, h: 3.4 } }],
  pins: [
    { id: "OUT_5V", label: "5V out (to your circuit)", role: "5v", voltage: 5, side: "right" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 0 },
  clearance: 1.5,
};
