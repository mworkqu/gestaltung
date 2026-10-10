import type { LibraryPart } from "../../schema";

// Capacitive soil moisture probe (v1.2 style): 98 x 23 mm coated blade, analog voltage out
// (lower voltage = wetter), 3-pin JST at the +x end. The blade goes in the soil; the electronics
// end stays dry.
export const soilMoistureCap: LibraryPart = {
  id: "soil_moisture_cap",
  name: { en: "Soil moisture probe", ar: "مسبار رطوبة التربة" },
  blurb: {
    en: "Pushes into the soil and tells your product whether a plant is thirsty.",
    ar: "يُغرس في التربة ويخبر منتجك إن كان النبات عطشان.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["soil", "moisture", "plant", "garden", "watering", "irrigation", "capacitive", "analog", "wet", "dry", "greenhouse", "farm", "agriculture", "sensor", "humidity"],
  dims: { x: 98, y: 23, z: 7.6 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.6,
      r: 2,
      feats: [
        { t: "box", x: -18, y: 0, w: 60, d: 15, h: 0.05, c: "#0f1a14", rough: 0.35 },
        { t: "box", x: 14, y: 0, w: 1.2, d: 21, h: 0.06, c: "#e0b838" },
        { t: "box", x: 30, y: 4.5, w: 5, d: 4, h: 1.4, c: "#15161a" },
        { t: "box", x: 38, y: -5, w: 4.6, d: 3.4, h: 1.2, c: "#15161a" },
        { t: "box", x: 34, y: -2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 40, y: 4, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "jst", x: 44, y: 0, w: 6, d: 8, h: 6 },
      ],
    },
  },
  look: { body: "pcb_green" },
  mount: null,
  ports: [],
  pins: [
    { id: "VCC", label: "VCC (3.3-5 V)", role: "vin", side: "right" },
    { id: "AOUT", label: "AOUT (moisture level)", role: "out", voltage: 3.3, side: "right" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "right" },
  ],
  power: { vMin: 3.3, vMax: 5.5, logicV: 5, mA: 5 },
  clearance: 2,
};
