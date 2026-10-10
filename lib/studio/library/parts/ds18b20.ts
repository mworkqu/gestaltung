import type { LibraryPart } from "../../schema";

// DS18B20 waterproof temperature probe on an adapter board (3-pin header with the 4.7 k
// pull-up already fitted). 1-Wire: one data wire on any free digital pin. Probe tube 6 mm.
export const ds18b20: LibraryPart = {
  id: "ds18b20",
  name: { en: "Waterproof temperature probe", ar: "مسبار حرارة مقاوم للماء" },
  blurb: {
    en: "A sealed probe on a cable that measures the temperature of liquids, soil or air.",
    ar: "مسبار محكم الإغلاق على كابل يقيس حرارة السوائل أو التربة أو الهواء.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["temperature", "ds18b20", "waterproof", "probe", "onewire", "1-wire", "thermometer", "liquid", "water", "aquarium", "fridge", "soil", "cable", "outdoor", "sensor", "heat"],
  dims: { x: 62, y: 12, z: 9 },
  model: { kind: "procedural", builder: "ds18b20Probe", params: {} },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [],
  pins: [
    { id: "VCC", label: "VCC (3-5.5 V)", role: "vin", side: "left" },
    { id: "DATA", label: "DATA (1-Wire)", role: "gpio", voltage: 3.3, side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3, vMax: 5.5, logicV: 5, mA: 1.5 },
  clearance: 1,
};
