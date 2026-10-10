import type { LibraryPart } from "../../schema";

// HC-SR501 PIR motion sensor. Dome on +z; supply 4.5-20 V, output is 3.3 V so
// it can be read directly by a 3.3 V or a 5 V board.
export const pirHcsr501: LibraryPart = {
  id: "pir_hcsr501",
  name: { en: "Motion sensor", ar: "حسّاس حركة" },
  blurb: {
    en: "Notices when a person moves nearby.",
    ar: "يلاحظ عندما يتحرّك شخص بالقرب منه.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["motion", "presence", "pir", "hc-sr501", "movement", "occupancy", "security", "alarm", "detect", "people", "infrared"],
  dims: { x: 32.2, y: 24.3, z: 18 },
  model: { kind: "procedural", builder: "pirSensor", params: {} },
  look: { body: "pcb_green" },
  mount: {
    holes: [
      { x: -14, y: 9.5, d: 2 },
      { x: 14, y: -9.5, d: 2 },
    ],
    standoffHeight: 4,
  },
  ports: [
    { kind: "sensor_window", face: "+z", at: { u: 0.5, v: 0.5 }, size: { w: 23, h: 23 } },
  ],
  pins: [
    { id: "VCC", label: "VCC (5 V)", role: "5v", voltage: 5, side: "left" },
    { id: "OUT", label: "OUT (motion signal)", role: "out", voltage: 3.3, side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 4.5, vMax: 20, logicV: 3.3, mA: 0.1 },
  clearance: 2,
};
