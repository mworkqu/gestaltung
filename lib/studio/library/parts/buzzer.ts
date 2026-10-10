import type { LibraryPart } from "../../schema";

// Active piezo buzzer, 12 mm: beeps at a fixed pitch when its + leg gets 3-5 V (a board pin can
// drive it directly). Sound comes out of the hole in the top.
export const buzzer: LibraryPart = {
  id: "buzzer",
  name: { en: "Beeper (buzzer)", ar: "صافرة تنبيه (بازر)" },
  blurb: {
    en: "Makes a beep to get attention, like an alarm or a button click.",
    ar: "تُصدر صفيراً لجذب الانتباه، مثل المنبّه أو نقرة الزر.",
  },
  category: "output",
  storeSkus: [],
  tags: ["buzzer", "beeper", "alarm", "alert", "sound", "beep", "piezo", "active", "notification", "warning", "pwm", "timer", "doorbell", "output"],
  dims: { x: 12.2, y: 12.2, z: 14.7 },
  model: { kind: "procedural", builder: "buzzer", params: {} },
  look: { body: "plastic_black" },
  mount: null,
  ports: [{ kind: "speaker_grille", face: "+z", at: { u: 0.5, v: 0.5 }, size: { w: 4, h: 4 } }],
  pins: [
    { id: "PLUS", label: "+ (signal, long leg)", role: "in", voltage: 3.3, side: "right" },
    { id: "MINUS", label: "- (GND)", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3, vMax: 5.3, logicV: 5, mA: 30 },
  clearance: 1,
};
