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
import { esp32C3Mini } from "./parts/esp32_c3_mini";
import { picoW } from "./parts/pico_w";
import { arduinoNano } from "./parts/arduino_nano";
import { aaHolder2 } from "./parts/aa_holder_2";
import { lipo1000 } from "./parts/lipo_1000";
import { usbcPower5v } from "./parts/usbc_power_5v";
import { boost5v } from "./parts/boost_5v";
import { buckConverter } from "./parts/buck_converter";
import { hcsr04 } from "./parts/hcsr04";
import { bh1750 } from "./parts/bh1750";
import { soilMoistureCap } from "./parts/soil_moisture_cap";
import { mpu6050 } from "./parts/mpu6050";
import { ds18b20 } from "./parts/ds18b20";
import { ldrModule } from "./parts/ldr_module";
import { oled13I2c } from "./parts/oled_13_i2c";
import { lcd1602I2c } from "./parts/lcd1602_i2c";
import { ws2812Ring } from "./parts/ws2812_ring";
import { buzzer } from "./parts/buzzer";
import { speakerAmp } from "./parts/speaker_amp";
import { relayModule } from "./parts/relay_module";
import { sg90Servo } from "./parts/sg90_servo";
import { n20Motor } from "./parts/n20_motor";
import { motorDriver } from "./parts/motor_driver";
import { rotaryEncoder } from "./parts/rotary_encoder";
import { slideSwitch } from "./parts/slide_switch";
import { microsdModule } from "./parts/microsd_module";
import { rtcDs3231 } from "./parts/rtc_ds3231";
import { usbcBreakout } from "./parts/usbc_breakout";
import { levelShifter4ch } from "./parts/level_shifter_4ch";

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
  esp32C3Mini,
  picoW,
  arduinoNano,
  aaHolder2,
  lipo1000,
  usbcPower5v,
  boost5v,
  buckConverter,
  hcsr04,
  bh1750,
  soilMoistureCap,
  mpu6050,
  ds18b20,
  ldrModule,
  oled13I2c,
  lcd1602I2c,
  ws2812Ring,
  buzzer,
  speakerAmp,
  relayModule,
  sg90Servo,
  n20Motor,
  motorDriver,
  rotaryEncoder,
  slideSwitch,
  microsdModule,
  rtcDs3231,
  usbcBreakout,
  levelShifter4ch,
];

const BY_ID = new Map(LIBRARY.map((p) => [p.id, p]));

// Browser-only overlay (P5-15c): owner edits from studio_parts, registered by
// StudioLibraryProvider so code that still calls the module-level getPart()
// (the 3D viewer) sees the same parts as the steps. Never set on the server
// (module state there is shared by every request — routes use makeLibrary()).
let clientOverlay: Map<string, LibraryPart> | null = null;
let clientList: LibraryPart[] | null = null;

/** Register the merged library in the browser (no-op on the server). */
export function setClientLibrary(parts: LibraryPart[] | null): void {
  if (typeof window === "undefined") return;
  clientList = parts && parts.length ? parts : null;
  clientOverlay = clientList ? new Map(clientList.map((p) => [p.id, p])) : null;
}

export function getPart(id: string): LibraryPart | undefined {
  return clientOverlay?.get(id) ?? BY_ID.get(id);
}

/** Parts of a category. Helpers (resistor, level shifter…) are hidden unless asked for. */
export function partsByCategory(cat: Category, includeHelpers = false): LibraryPart[] {
  return (clientList ?? LIBRARY).filter((p) => p.category === cat && (includeHelpers || !p.helper));
}

export type AIIndexEntry = {
  id: string;
  category: Category;
  tags: string[];
  name: string;
  power: { vMin: number; vMax: number; mA: number };
  logicV: 3.3 | 5;
};

function indexFor(parts: LibraryPart[]): AIIndexEntry[] {
  return parts.filter((p) => !p.helper).map((p) => ({
    id: p.id,
    category: p.category,
    tags: p.tags,
    name: p.name.en,
    power: { vMin: p.power.vMin, vMax: p.power.vMax, mA: p.power.mA },
    logicV: p.power.logicV,
  }));
}

/** Compact catalogue handed to the AI picker (helper parts excluded). */
export function libraryIndexForAI(): AIIndexEntry[] {
  return indexFor(LIBRARY);
}

/** A library over any part list (the merged code + studio_parts list, per request). */
export type StudioLibrary = {
  parts: LibraryPart[];
  getPart: (id: string) => LibraryPart | undefined;
  partsByCategory: (cat: Category, includeHelpers?: boolean) => LibraryPart[];
  libraryIndexForAI: () => AIIndexEntry[];
};

export function makeLibrary(parts: LibraryPart[]): StudioLibrary {
  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    parts,
    getPart: (id) => byId.get(id),
    partsByCategory: (cat, includeHelpers = false) =>
      parts.filter((p) => p.category === cat && (includeHelpers || !p.helper)),
    libraryIndexForAI: () => indexFor(parts),
  };
}

/** The code library as a StudioLibrary (the default everywhere). */
export const CODE_LIBRARY: StudioLibrary = makeLibrary(LIBRARY);

export { validatePart } from "./validate";
