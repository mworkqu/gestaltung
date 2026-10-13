import type { LibraryPart } from "../../schema";

// MG996R metal-gear standard servo: 40.7 x 19.7 mm body, 54 mm across the ears, 42.9 mm tall with the
// horn, turns about 180 degrees. Signal accepts 3.3 V; it needs 4.8-7.2 V (use 5-6 V). It draws about
// 500 mA moving and up to ~2.5 A stalled, so `power.mA` holds the STALL current (the worst case for the
// power budget). Pins use the same ids as sg90_servo. Wires leave the -x end; the shaft sits 10 mm from
// the +x end of the body.
export const mg996rServo: LibraryPart = {
  id: "mg996r_servo",
  name: { en: "Strong metal-gear servo (MG996R)", ar: "سيرفو قوي بتروس معدنية (MG996R)" },
  blurb: {
    en: "A strong servo that turns a heavy arm or joint to an exact angle, for robot arms and big flaps.",
    ar: "سيرفو قوي يدير ذراعاً أو مفصلاً ثقيلاً إلى زاوية دقيقة، للأذرع الروبوتية والأغطية الكبيرة.",
  },
  category: "actuator",
  storeSkus: [],
  tags: ["servo", "mg996r", "metal", "motor", "angle", "arm", "pwm", "robot", "gripper", "joint", "heavy", "torque", "strong", "5v", "6v", "actuator", "movement"],
  dims: { x: 54, y: 19.7, z: 42.9 },
  model: {
    kind: "procedural",
    builder: "servo",
    params: { bodyL: 40.7, bodyH: 35.8, color: "#23262d", earZ: 25.5, shaftX: 10, hornLen: 26 },
  },
  look: { body: "plastic_black", accent: "#c9a227" },
  mount: null,
  ports: [],
  pins: [
    { id: "SIG", label: "Signal (orange)", role: "pwm", voltage: 3.3, side: "left" },
    { id: "VCC", label: "V+ (red, 4.8-7.2 V)", role: "5v", voltage: 5, side: "left" },
    { id: "GND", label: "GND (brown)", role: "gnd", voltage: 0, side: "left" },
  ],
  // mA = stall current (~2500 mA); about 500 mA while moving under load.
  power: { vMin: 4.8, vMax: 7.2, logicV: 5, mA: 2500 },
  clearance: 3,
};
