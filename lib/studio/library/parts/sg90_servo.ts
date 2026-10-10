import type { LibraryPart } from "../../schema";

// SG90-style 9 g micro servo: 22.8 x 12.2 x 22.7 mm body, 32.5 mm across the ears, turns about 180
// degrees. Signal accepts 3.3 V; it needs a 4.8-6 V supply. Wires leave the -x end; no enclosure
// port kind fits the shaft, so the part has no ports (leave room for the horn).
export const sg90Servo: LibraryPart = {
  id: "sg90_servo",
  name: { en: "Small motor that turns to an angle (servo)", ar: "محرّك صغير يدور إلى زاوية محددة (سيرفو)" },
  blurb: {
    en: "Turns an arm to an exact angle, for flaps, latches, pointers and small robots.",
    ar: "يدير ذراعاً إلى زاوية دقيقة، للأغطية والمزاليج والمؤشرات والروبوتات الصغيرة.",
  },
  category: "actuator",
  storeSkus: [],
  tags: ["servo", "sg90", "motor", "angle", "arm", "pwm", "flap", "latch", "lock", "feeder", "robot", "gripper", "pointer", "door", "5v", "actuator", "movement"],
  dims: { x: 32.5, y: 12.2, z: 29.8 },
  model: { kind: "procedural", builder: "servo", params: {} },
  look: { body: "plastic_black", accent: "#2c78d6" },
  mount: null,
  ports: [],
  pins: [
    { id: "SIG", label: "Signal (orange)", role: "pwm", voltage: 3.3, side: "left" },
    { id: "VCC", label: "VCC (red, 5 V)", role: "5v", voltage: 5, side: "left" },
    { id: "GND", label: "GND (brown)", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 4.8, vMax: 6, logicV: 5, mA: 250 },
  clearance: 3,
};
