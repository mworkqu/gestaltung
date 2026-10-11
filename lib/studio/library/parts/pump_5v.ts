import type { LibraryPart } from "../../schema";

// Mini submersible water pump, 3–5 V DC (JT-180 style, ~120 L/h): sits in the water tank and
// pushes water up a 7 mm tube. A small DC motor inside = an inductive load, so the wiring adds
// a driver (motor_driver / relay_module) and never drives it from a pin. Added by the idea
// guards (W3) whenever "automatic watering" or a pump is asked for (spec.outputs "pump").
// Two wires; M_PLUS goes to the driver output, M_MINUS is the return (as n20_motor).
export const pump5v: LibraryPart = {
  id: "pump_5v",
  name: { en: "Small water pump (5 V)", ar: "مضخة ماء صغيرة (5 فولت)" },
  blurb: {
    en: "A tiny pump that sits in a water cup or tank and waters the plant when the board tells it to.",
    ar: "مضخة صغيرة توضع في كوب أو خزان ماء وتسقي النبتة عندما تأمرها اللوحة.",
  },
  category: "actuator",
  storeSkus: ["VLT-39404718030950"],
  tags: ["pump", "water", "watering", "irrigation", "plant", "garden", "submersible", "inductive", "dc", "motor", "5v", "actuator", "aquarium", "fountain"],
  dims: { x: 53, y: 24, z: 33 },
  model: { kind: "procedural", builder: "waterPump", params: {} },
  look: { body: "plastic_black" },
  mount: null,
  ports: [],
  pins: [
    { id: "M_PLUS", label: "Pump wire + (to driver OUT1)", role: "in", side: "left" },
    { id: "M_MINUS", label: "Pump wire − (return)", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3, vMax: 5, logicV: 5, mA: 200 },
  clearance: 2,
};
