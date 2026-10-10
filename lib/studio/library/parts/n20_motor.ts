import type { LibraryPart } from "../../schema";

// N20 micro gear motor (6 V): 12 x 10 mm can, brass gearbox, 3 mm D-shaft. A bare motor is an
// inductive load: the wiring adds a driver (motor_driver). Two wires; M_PLUS is wired to the
// driver output, M_MINUS is modelled as the return (see the report on multi-wire motor pins).
export const n20Motor: LibraryPart = {
  id: "n20_motor",
  name: { en: "Small geared motor (N20)", ar: "محرّك صغير بتروس (N20)" },
  blurb: {
    en: "A tiny motor with gears that turns a wheel or a gear slowly with good force.",
    ar: "محرّك صغير بتروس يدير عجلة أو ترساً ببطء وبقوة جيدة.",
  },
  category: "actuator",
  storeSkus: [],
  tags: ["motor", "inductive", "dc", "n20", "gear", "gearmotor", "geared", "wheel", "robot", "car", "spin", "rotate", "6v", "actuator", "movement", "drive"],
  dims: { x: 34, y: 12, z: 10 },
  model: { kind: "procedural", builder: "n20Motor", params: {} },
  look: { body: "metal" },
  mount: null,
  ports: [],
  pins: [
    { id: "M_PLUS", label: "Motor wire 1 (to driver OUT1)", role: "in", side: "left" },
    { id: "M_MINUS", label: "Motor wire 2 (return)", role: "gnd", voltage: 0, side: "left" },
  ],
  power: { vMin: 3, vMax: 6, logicV: 5, mA: 150 },
  clearance: 2,
};
