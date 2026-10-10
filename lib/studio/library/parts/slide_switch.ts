import type { LibraryPart } from "../../schema";

// SS12D-style slide switch lying on its side so the handle comes out of the +y face: slide it
// left/right to change between two states. The wiring treats it like a button (one leg to a board
// pin, the other to GND); wiring it in series with the battery needs a manual connection.
export const slideSwitch: LibraryPart = {
  id: "slide_switch",
  name: { en: "Slide switch (on / off)", ar: "مفتاح انزلاقي (تشغيل / إيقاف)" },
  blurb: {
    en: "A little lever you slide to switch something on or off.",
    ar: "ذراع صغير تنزلق به لتشغيل شيء أو إطفائه.",
  },
  category: "input",
  storeSkus: [],
  tags: ["switch", "slide", "toggle", "power-switch", "on-off", "lever", "mode", "input", "select", "side", "control", "ss12d"],
  dims: { x: 11.6, y: 8.2, z: 9 },
  model: { kind: "procedural", builder: "slideSwitch", params: {} },
  look: { body: "plastic_black" },
  mount: null,
  ports: [{ kind: "button_cap", face: "+y", at: { u: 0.5, v: 0.667 }, size: { w: 7, h: 3.5 } }],
  pins: [
    { id: "A", label: "Common", role: "in", side: "left" },
    { id: "B", label: "Throw", role: "out", side: "right" },
  ],
  power: { vMin: 0, vMax: 5, logicV: 5, mA: 0 },
  clearance: 1,
};
