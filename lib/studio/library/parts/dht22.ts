import type { LibraryPart } from "../../schema";

// DHT22 / AM2302 temperature + humidity sensor. Stands on its edge: vented
// face looks toward +x, pins point to -y. Works from 3.3 V to 6 V (logic follows supply).
export const dht22: LibraryPart = {
  id: "dht22",
  name: { en: "Temperature and humidity sensor", ar: "حسّاس الحرارة والرطوبة" },
  blurb: {
    en: "Measures how warm and how damp the air is.",
    ar: "يقيس درجة حرارة الهواء ونسبة رطوبته.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["temperature", "humidity", "dht22", "am2302", "climate", "weather", "air", "thermometer", "room", "greenhouse", "sensor"],
  dims: { x: 7.7, y: 30, z: 15.1 },
  model: { kind: "procedural", builder: "dht22", params: {} },
  look: { body: "plastic_white" },
  mount: null,
  ports: [
    { kind: "sensor_window", face: "+x", at: { u: 0.62, v: 0.5 }, size: { w: 16, h: 10 } },
  ],
  pins: [
    { id: "VCC", label: "VCC (3.3-5 V)", role: "vin", side: "bottom" },
    { id: "DATA", label: "DATA", role: "out", voltage: 5, side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
  ],
  power: { vMin: 3.3, vMax: 6, logicV: 5, mA: 1.5 },
  clearance: 1,
};
