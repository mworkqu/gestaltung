import type { LibraryPart } from "../../schema";

// HC-SR04 ultrasonic distance sensor: 45 x 20 mm board, two 16 mm transducers 26 mm apart.
// Modelled standing upright, header pins pointing down, transducers looking toward +y, so
// both round windows are on the +y face. The ECHO output swings 5 V (wiring adds a level
// shifter for 3.3 V boards).
export const hcsr04: LibraryPart = {
  id: "hcsr04",
  name: { en: "Distance sensor (ultrasonic)", ar: "حسّاس مسافة (بالموجات فوق الصوتية)" },
  blurb: {
    en: "Measures how far away an object is by sending out a sound too high to hear.",
    ar: "يقيس بُعد الجسم بإرسال صوت أعلى من أن يُسمع.",
  },
  category: "sensor",
  storeSkus: [],
  tags: ["distance", "ultrasonic", "hc-sr04", "hcsr04", "range", "proximity", "obstacle", "level", "parking", "robot", "sonar", "measure", "tank", "5v", "sensor"],
  dims: { x: 45, y: 16.5, z: 26 },
  model: { kind: "procedural", builder: "ultrasonicSensor", params: { spacing: 26 } },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [
    { kind: "sensor_window", face: "+y", at: { u: 0.211, v: 0.615 }, size: { w: 16, h: 16 } },
    { kind: "sensor_window", face: "+y", at: { u: 0.789, v: 0.615 }, size: { w: 16, h: 16 } },
  ],
  pins: [
    { id: "VCC", label: "VCC (5 V)", role: "5v", voltage: 5, side: "bottom" },
    { id: "TRIG", label: "TRIG", role: "in", voltage: 5, side: "bottom" },
    { id: "ECHO", label: "ECHO", role: "out", voltage: 5, side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
  ],
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 15 },
  clearance: 2,
};
