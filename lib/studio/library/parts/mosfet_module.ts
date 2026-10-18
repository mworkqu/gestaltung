import type { LibraryPart } from "../../schema";

// Logic-level MOSFET switch module (AO3400 / D4184 style, flyback diode on board): lets a
// 3.3 V or 5 V pin switch a pump, fan or one-way motor on and off (PWM for speed). The
// wiring prefers it for loads that only switch on/off; a motor that must reverse keeps the
// H-bridge (motor_driver). Store: the IRF520 MOSFET driver module (best with a 5 V board such
// as the Arduino Uno; on a 3.3 V board a logic-level module switches harder loads better).
export const mosfetModule: LibraryPart = {
  id: "mosfet_module",
  name: { en: "MOSFET switch module", ar: "وحدة مفتاح MOSFET" },
  blurb: {
    en: "Lets your board switch a pump or motor on and off safely.",
    ar: "تتيح للوحتك تشغيل المضخة أو المحرّك وإيقافه بأمان.",
  },
  category: "actuator",
  storeSkus: ["VLT-32033979334758"],
  tags: ["driver", "module", "mosfet", "switch", "transistor", "pump", "fan", "on_off", "pwm", "flyback", "diode", "actuator"],
  dims: { x: 22, y: 16, z: 8 },
  model: {
    kind: "procedural",
    builder: "moduleBoard",
    params: {
      boardT: 1.2,
      r: 0.8,
      feats: [
        { t: "box", x: 1, y: 0, w: 3, d: 3, h: 1.1, c: "#15161a" },
        { t: "box", x: -4, y: 2, w: 2.6, d: 1.4, h: 1, c: "#15161a" },
        { t: "box", x: 6.5, y: 0, w: 5, d: 7.5, h: 6, c: "#2f6fd6" },
        { t: "led", x: -6.5, y: -3, c: "#e8413c" },
      ],
      rows: [{ x: -7.6, y: 0, n: 4, axis: "y", kind: "pins" }],
    },
  },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [],
  pins: [
    { id: "VIN", label: "VIN (load power, 5 V for the pump)", role: "5v", side: "bottom" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "bottom" },
    { id: "SIG", label: "SIG (on / off, PWM)", role: "pwm", voltage: 3.3, side: "bottom" },
    { id: "OUT", label: "OUT (to pump or motor)", role: "out", side: "top" },
  ],
  power: { vMin: 3, vMax: 24, logicV: 3.3, mA: 5 },
  clearance: 1.5,
};
