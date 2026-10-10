// The component library: the only parts the studio may pick from.

import type { Category, LibraryPart } from "../schema";
import { esp32Devkit } from "./parts/esp32_devkit";
import { arduinoUno } from "./parts/arduino_uno";
import { cell18650 } from "./parts/cell_18650";
import { tp4056Usbc } from "./parts/tp4056_usbc";
import { pirHcsr501 } from "./parts/pir_hcsr501";
import { dht22 } from "./parts/dht22";
import { oled096I2c } from "./parts/oled_096_i2c";
import { button6mm } from "./parts/button_6mm";
import { led5mm } from "./parts/led_5mm";
import { resistor220 } from "./parts/resistor_220";

export const LIBRARY: LibraryPart[] = [
  esp32Devkit,
  arduinoUno,
  cell18650,
  tp4056Usbc,
  pirHcsr501,
  dht22,
  oled096I2c,
  button6mm,
  led5mm,
  resistor220,
];

const BY_ID = new Map(LIBRARY.map((p) => [p.id, p]));

export function getPart(id: string): LibraryPart | undefined {
  return BY_ID.get(id);
}

/** Parts of a category. Helpers (resistor, level shifter…) are hidden unless asked for. */
export function partsByCategory(cat: Category, includeHelpers = false): LibraryPart[] {
  return LIBRARY.filter((p) => p.category === cat && (includeHelpers || !p.helper));
}

export type AIIndexEntry = {
  id: string;
  category: Category;
  tags: string[];
  name: string;
  power: { vMin: number; vMax: number; mA: number };
  logicV: 3.3 | 5;
};

/** Compact catalogue handed to the AI picker (helper parts excluded). */
export function libraryIndexForAI(): AIIndexEntry[] {
  return LIBRARY.filter((p) => !p.helper).map((p) => ({
    id: p.id,
    category: p.category,
    tags: p.tags,
    name: p.name.en,
    power: { vMin: p.power.vMin, vMax: p.power.vMax, mA: p.power.mA },
    logicV: p.power.logicV,
  }));
}

export { validatePart } from "./validate";
