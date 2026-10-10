// Small hand-made LibraryPart fixtures for the wiring tests (not the real library).

import type { Category, LibraryPart, Pin, PinRole, StudioComponent } from "../schema";

type PinSpec = [id: string, role: PinRole, extra?: Partial<Pin>];

export function part(
  id: string,
  category: Category,
  pins: PinSpec[],
  opts: {
    tags?: string[];
    power?: Partial<LibraryPart["power"]>;
    requires?: LibraryPart["requires"];
    helper?: boolean;
    name?: string;
    nameAr?: string;
  } = {},
): LibraryPart {
  return {
    id,
    name: { en: opts.name ?? id.replace(/_/g, " "), ar: opts.nameAr ?? `قطعة ${id.length}` },
    blurb: { en: "", ar: "" },
    category,
    storeSkus: [],
    tags: opts.tags ?? [],
    dims: { x: 10, y: 10, z: 5 },
    model: { kind: "procedural", builder: "box", params: {} },
    look: { body: "pcb_green" },
    mount: null,
    ports: [],
    pins: pins.map(([pid, role, extra]) => ({ id: pid, label: pid, role, ...extra })),
    power: { vMin: 3, vMax: 5.5, logicV: 3.3, mA: 10, ...opts.power },
    requires: opts.requires,
    clearance: 1,
    helper: opts.helper,
  };
}

/** A tiny 3.3 V board: 3 gpio, an I2C pair, rails on both sides. */
export const MINI_MCU = part(
  "mini_mcu",
  "mcu",
  [
    ["3V3", "3v3", { voltage: 3.3, side: "left" }],
    ["5V", "5v", { voltage: 5, side: "left" }],
    ["GND", "gnd", { side: "left" }],
    ["G1", "gpio", { side: "left" }],
    ["G2", "gpio", { side: "left" }],
    ["G3", "pwm", { side: "right" }],
    ["A1", "adc", { side: "right" }],
    ["SDA", "i2c_sda", { side: "right" }],
    ["SCL", "i2c_scl", { side: "right" }],
  ],
  { tags: ["esp32"], power: { vMin: 4.5, vMax: 5.5, logicV: 3.3, mA: 80 }, name: "Mini ESP32 board" },
);

export const BUTTON = part("btn_tact", "input", [["P1", "in"], ["P2", "out"]], {
  tags: ["button"],
  power: { vMin: 0, vMax: 5, logicV: 5, mA: 0 },
  name: "Tact button",
});
export const LED = part("led_red", "output", [["A", "in"], ["K", "gnd"]], {
  tags: ["led"],
  power: { vMin: 1.8, vMax: 3.3, logicV: 5, mA: 20 },
  requires: [{ id: "res_330", reason: "Limits the current." }],
  helper: true,
  name: "Red light",
});
export const RESISTOR = part("res_330", "power", [["1", "in"], ["2", "out"]], {
  tags: ["resistor", "led"],
  power: { vMin: 0, vMax: 5, logicV: 5, mA: 0 },
  helper: true,
  name: "Small resistor",
});
/** A 5 V-only sensor whose output swings to 5 V. */
export const SONAR = part("sonar_5v", "sensor", [["VCC", "vin"], ["ECHO", "out"], ["TRIG", "in"], ["GND", "gnd"]], {
  power: { vMin: 4.5, vMax: 5.5, logicV: 5, mA: 15 },
  name: "Distance sensor",
});
export const SHIFTER = part(
  "level_shifter_4ch",
  "power",
  [
    ["LV", "3v3"],
    ["HV", "5v"],
    ["GND", "gnd"],
    ["LV1", "gpio", { voltage: 3.3 }],
    ["LV2", "gpio", { voltage: 3.3 }],
    ["LV3", "gpio", { voltage: 3.3 }],
    ["LV4", "gpio", { voltage: 3.3 }],
    ["HV1", "gpio", { voltage: 5 }],
    ["HV2", "gpio", { voltage: 5 }],
    ["HV3", "gpio", { voltage: 5 }],
    ["HV4", "gpio", { voltage: 5 }],
  ],
  { tags: ["level_shifter"], helper: true, power: { vMin: 1.8, vMax: 5.5, logicV: 5, mA: 1 }, name: "Level adapter" },
);
export const MOTOR = part("dc_motor", "actuator", [["PLUS", "vin"], ["MINUS", "gnd"]], {
  tags: ["motor"],
  power: { vMin: 3, vMax: 6, logicV: 5, mA: 250 },
  name: "Small motor",
});
export const DRIVER = part("mosfet_driver", "output", [["VCC", "vin"], ["IN", "in"], ["OUT", "out"], ["GND", "gnd"]], {
  tags: ["driver", "mosfet"],
  power: { vMin: 3, vMax: 5.5, logicV: 3.3, mA: 2 },
  name: "Motor switch board",
});

export function lib(...parts: LibraryPart[]) {
  const m = new Map(parts.map((p) => [p.id, p]));
  return (id: string) => m.get(id);
}

/** Components from part ids, numbered per part: a_1, a_2, b_1… */
export function comps(...ids: string[]): StudioComponent[] {
  const n = new Map<string, number>();
  return ids.map((id) => {
    const k = (n.get(id) ?? 0) + 1;
    n.set(id, k);
    return { partId: id, instanceId: `${id}_${k}`, label: id };
  });
}
