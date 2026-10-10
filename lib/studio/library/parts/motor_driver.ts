import type { LibraryPart } from "../../schema";

// DRV8833-style dual H-bridge motor driver (one channel used): lets a 3.3 V or 5 V pin run a small
// DC motor in either direction (IN1/IN2 as PWM). Id and tags match the wiring's driver lookup
// (motor_driver; tags driver + module), so it is added automatically for a bare motor.
export const motorDriver: LibraryPart = {
  id: "motor_driver",
  name: { en: "Motor driver board", ar: "لوحة تشغيل المحرّك" },
  blurb: {
    en: "Lets your board spin a small motor forwards and backwards at any speed.",
    ar: "تتيح للوحتك تدوير محرّك صغير للأمام وللخلف بأي سرعة.",
  },
  category: "actuator",
  storeSkus: [],
  tags: ["driver", "module", "motor_driver", "h-bridge", "drv8833", "motor", "dc", "speed", "direction", "pwm", "robot", "wheel", "controller", "actuator"],
  dims: { x: 20, y: 16, z: 8.5 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "box", x: 2, y: 0, w: 5, d: 4.4, h: 1.2, c: "#15161a" },
        { t: "box", x: -5, y: 0, w: 3.2, d: 1.6, h: 0.9, c: "#d9b13b" },
        { t: "box", x: 8, y: 2.5, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "box", x: 8, y: -2.5, w: 1.6, d: 0.8, h: 0.5, c: "#2a2523" },
        { t: "led", x: -6.5, y: 3, c: "#35d07f" },
      ],
      rows: [
        { x: 0, y: -6.35, n: 4, kind: "pins" },
        { x: -3.8, y: 6.35, n: 2, kind: "pins" },
      ],
    },
  },
  look: { body: "pcb_black" },
  mount: null,
  ports: [],
  pins: [
    { id: "VCC", label: "VCC (motor power, 2.7-10 V)", role: "vin", side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "IN1", label: "IN1 (speed / direction)", role: "pwm", voltage: 3.3, side: "bottom" },
    { id: "IN2", label: "IN2 (speed / direction)", role: "pwm", voltage: 3.3, side: "bottom" },
    { id: "OUT1", label: "OUT1 (to motor)", role: "out", side: "top" },
    { id: "OUT2", label: "OUT2 (to motor)", role: "out", side: "top" },
  ],
  power: { vMin: 2.7, vMax: 10.8, logicV: 3.3, mA: 10 },
  clearance: 1.5,
};
