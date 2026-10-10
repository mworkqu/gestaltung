import type { LibraryPart } from "../../schema";

// BH1750 (GY-302) ambient light sensor, I2C, reads in lux. Onboard regulator: 3-5 V supply,
// 3.3 V signals. The sensor chip sits at the +x end; pin header at the -y edge.
export const bh1750: LibraryPart = {
  id: "bh1750",
  name: { en: "Light level sensor (lux)", ar: "حسّاس شدّة الإضاءة (لوكس)" },
  blurb: {
    en: "Tells your product how bright the room or the sun is, in real units.",
    ar: "يخبر منتجك بمدى سطوع الغرفة أو الشمس بوحدات حقيقية.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["light", "lux", "brightness", "ambient", "daylight", "bh1750", "gy-302", "i2c", "sun", "lamp", "auto-brightness", "greenhouse", "sensor", "illuminance"],
  dims: { x: 18.5, y: 14, z: 10 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "box", x: 3, y: 2.5, w: 4.8, d: 3.2, h: 1, c: "#dfe7ef", rough: 0.2 },
        { t: "box", x: -4.5, y: 2.5, w: 3, d: 2.6, h: 1, c: "#15161a" },
        { t: "box", x: -1, y: -2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 6.5, y: -2, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: 7, y: 4.5, c: "#35d07f" },
      ],
      rows: [{ x: 0, y: -5.5, n: 5, kind: "pins" }],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [{ kind: "sensor_window", face: "+z", at: { u: 0.662, v: 0.679 }, size: { w: 6, h: 6 } }],
  pins: [
    { id: "VCC", label: "VCC (3-5 V)", role: "vin", side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "SCL", label: "SCL", role: "i2c_scl", voltage: 3.3, side: "bottom" },
    { id: "SDA", label: "SDA", role: "i2c_sda", voltage: 3.3, side: "bottom" },
  ],
  power: { vMin: 3, vMax: 5, logicV: 3.3, mA: 0.2 },
  clearance: 1.5,
};
