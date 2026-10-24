// Pure helpers of the Design Studio wiring (part classification, charger pins,
// rail ranges, the servo supply), split out of netlist.ts so plain-checks.ts can
// use them without importing netlist.ts (which imports plain-checks.ts): that was
// the only runtime import cycle in the repo. netlist.ts re-exports the public
// names below, so existing importers keep working.
//
// Pure and client-safe.

import type { LibraryPart, Pin, PinRole, StudioComponent } from "./schema";
import type { ServoPlan } from "./servo-plan";
import type { Locale } from "@/lib/locale";

export type GetPart = (id: string) => LibraryPart | undefined;
export type { Locale };

// ── Part classification (tags / roles only, generic over the library) ──────

const POWER_ROLES: ReadonlySet<PinRole> = new Set<PinRole>(["vin", "3v3", "5v"]);
export const isPowerRole = (r: PinRole) => POWER_ROLES.has(r);
export const isSignalRole = (r: PinRole) => !POWER_ROLES.has(r) && r !== "gnd";

const norm = (s: string) => s.toLowerCase().replace(/[\s-]+/g, "_");
/** A tag (or a whole `_`-separated word run of the id) equals one of `words`. */
export function tagged(p: LibraryPart, words: readonly string[]): boolean {
  const tags = p.tags.map(norm);
  const id = `_${p.id}_`;
  return words.some((w) => tags.includes(w) || id.includes(`_${w}_`));
}

export const isMcu = (p: LibraryPart) => p.category === "mcu";
export const isCharger = (p: LibraryPart) => p.category === "power" && tagged(p, ["charger", "tp4056"]);
export const isBattery = (p: LibraryPart) =>
  p.category === "power" && !isCharger(p) && tagged(p, ["battery", "cell", "lipo", "li_ion", "18650"]);
export const isShifter = (p: LibraryPart) => tagged(p, ["level_shifter", "shifter", "logic_level", "logic_level_converter"]);
/** A regulator / buck / boost: a vin pin in, a 3v3 or 5v pin out. */
export const isConverter = (p: LibraryPart) =>
  p.category === "power" &&
  !isBattery(p) &&
  !isCharger(p) &&
  p.pins.some((x) => x.role === "vin") &&
  p.pins.some((x) => x.role === "3v3" || x.role === "5v");
/** Battery, charger or converter: wired by the power plan, not as a load. */
export const isPowerSource = (p: LibraryPart) => isBattery(p) || isCharger(p) || isConverter(p);

export type SymbolKind = "resistor" | "led" | "diode";
/** Two-legged parts drawn as a schematic symbol (resistor zigzag, LED triangle). */
export function symbolKind(p: LibraryPart): SymbolKind | null {
  if (p.pins.length !== 2 || p.pins.some((x) => isPowerRole(x.role))) return null;
  if (tagged(p, ["resistor"])) return "resistor";
  if (tagged(p, ["led"])) return "led";
  if (tagged(p, ["diode"])) return "diode";
  return null;
}
/** A helper that sits in series on its host's signal line (a resistor). */
export const isSeriesHelper = (p: LibraryPart) => symbolKind(p) === "resistor";
export const isButton = (p: LibraryPart) =>
  tagged(p, ["button", "switch", "pushbutton", "push_button"]) && !p.pins.some((x) => x.role === "gnd" || isPowerRole(x.role));
export const isInductive = (p: LibraryPart) =>
  tagged(p, ["motor", "solenoid", "pump", "relay", "relay_coil", "fan", "coil"]) &&
  !tagged(p, ["module", "driver", "servo", "stepper", "relay_module"]);
/** A servo driver board (PCA9685): servos plug into its channels, it talks I2C to the board. */
export const isServoDriver = (p: LibraryPart) => tagged(p, ["servo_driver", "pca9685"]);
/** A driver that switches an inductive load (never the servo driver: servos are not inductive loads). */
export const isDriver = (p: LibraryPart) =>
  !isServoDriver(p) &&
  (tagged(p, ["driver", "mosfet", "transistor", "relay_module", "h_bridge"]) ||
    (tagged(p, ["relay"]) && tagged(p, ["module"])));
/** Servo driver channel pins ("CH3_PWM", "CH3_V", "CH3_GND"): channel number, else null. */
export function servoChannelOf(pinId: string): number | null {
  const m = /^CH(\d+)_(PWM|V|GND)$/.exec(pinId);
  return m ? Number(m[1]) : null;
}
/**
 * Pins of a servo driver left open on purpose: OE (optional, pulled low on the board)
 * and every channel no servo is plugged into. Never "unconnected", never a board pin.
 */
export const openByDesign = (p: LibraryPart, pin: Pin) =>
  isServoDriver(p) && (pin.id === "OE" || servoChannelOf(pin.id) !== null);
export const wantsPwm = (p: LibraryPart) => tagged(p, ["pwm", "servo", "buzzer", "dimmable", "dimmer", "speaker"]);
export const isAnalog = (p: LibraryPart) => tagged(p, ["analog", "analogue"]);

/** Helper part ids we add when the library has them (skipped silently otherwise). */
export const LEVEL_SHIFTER_IDS = ["level_shifter_4ch", "level_shifter"] as const;
export const DRIVER_IDS = ["mosfet_driver", "mosfet_module", "motor_driver", "relay_module"] as const;
/** On/off switches (MOSFET) vs direction + speed (H-bridge). */
export const SWITCH_DRIVER_IDS = ["mosfet_module", "mosfet_driver"] as const;
export const HBRIDGE_DRIVER_IDS = ["motor_driver"] as const;
/**
 * A load that only ever switches on and off (one direction): a pump, fan, solenoid or
 * relay coil gets a MOSFET switch; a motor that may need to reverse keeps the H-bridge.
 */
export const isOnOffLoad = (p: LibraryPart) => tagged(p, ["pump", "fan", "solenoid", "relay_coil", "coil"]);
export const isHBridge = (p: LibraryPart) => tagged(p, ["h-bridge", "h_bridge", "motor_driver"]);
/** Does this driver suit that load? (MOSFET for on/off loads, H-bridge for motors.) */
export const driverSuits = (driver: LibraryPart, load: LibraryPart) => (isOnOffLoad(load) ? !isHBridge(driver) : isHBridge(driver));
export const BOOSTER_IDS = ["boost_5v"] as const;

export const ref = (inst: string, pin: string) => `${inst}.${pin}`;
/** "esp32_devkit_1.GPIO21" → ["esp32_devkit_1", "GPIO21"]. */
export function splitRef(r: string): [string, string] {
  const i = r.indexOf(".");
  return i < 0 ? [r, ""] : [r.slice(0, i), r.slice(i + 1)];
}

// ── Charger pins (by label, the roles of a charger board are not uniform) ──

export type ChargerPins = { bat?: Pin; out?: Pin; inp?: Pin; batGnd?: Pin; outGnd: Pin[]; inGnd?: Pin };
export function chargerPins(p: LibraryPart): ChargerPins {
  const txt = (x: Pin) => `${x.id} ${x.label}`.toUpperCase();
  const isBatSide = (x: Pin) => /(^|[^A-Z])B(AT|ATT)?[_ ]?(\+|PLUS|-|MINUS)|BATTERY/.test(txt(x));
  const isIn = (x: Pin) => /(^|[^A-Z])IN([_ +-]|PLUS|MINUS|$)|USB/.test(txt(x)) && !/OUT/.test(txt(x));
  const pos = p.pins.filter((x) => x.role !== "gnd");
  const gnd = p.pins.filter((x) => x.role === "gnd");
  const bat = pos.find(isBatSide) ?? pos.find((x) => !isIn(x) && !/OUT/.test(txt(x)));
  const out = pos.find((x) => x !== bat && /OUT/.test(txt(x)));
  const inp = pos.find((x) => x !== bat && x !== out && isIn(x));
  const batGnd = gnd.find(isBatSide);
  const inGnd = gnd.find((x) => x !== batGnd && isIn(x));
  return { bat, out, inp, batGnd, inGnd, outGnd: gnd.filter((x) => x !== batGnd && x !== inGnd) };
}

export const RAIL_RANGE: Record<"vin" | "5v" | "3v3", (mcu: LibraryPart) => [number, number]> = {
  vin: (m) => [m.power.vMin, m.power.vMax],
  "5v": () => [4.5, 5.5],
  "3v3": () => [3.0, 3.6],
};

export const DEV_TO_MCU: ReadonlySet<PinRole> = new Set<PinRole>(["out", "gpio", "uart_tx", "i2c_sda", "i2c_scl", "spi_miso"]);
export const MCU_TO_DEV: ReadonlySet<PinRole> = new Set<PinRole>([
  "in", "gpio", "uart_rx", "i2c_sda", "i2c_scl", "spi_mosi", "spi_sck", "spi_cs", "pwm",
]);

/**
 * The wall supply that feeds servos through a servo driver (Part E): its 5 V output pin
 * and what it can give. Null without a driver, or when the servos run from the board.
 */
export function servoSupplyRail(
  sp: ServoPlan | null,
  entries: readonly { c: StudioComponent; p: LibraryPart }[],
): { inst: string; ref: string; maxMa: number } | null {
  if (!sp?.driver || !sp.supply || sp.poweredFrom !== "supply") return null;
  const e = entries.find((x) => x.c.instanceId === sp.supply);
  const out = e?.p.pins.find((x) => x.role === "5v");
  if (!e || !out) return null;
  return { inst: e.c.instanceId, ref: ref(e.c.instanceId, out.id), maxMa: sp.supplyMA ?? e.p.power.supplyMA ?? 0 };
}

// ── Entries (a component with its library part) ─────────────────────────────

export type Entry = { c: StudioComponent; p: LibraryPart };

export function entriesOf(components: StudioComponent[], getPart: GetPart): Entry[] {
  const out: Entry[] = [];
  for (const c of components) {
    const p = getPart(c.partId);
    if (p) out.push({ c, p });
  }
  return out;
}

/** Level shifter channels: low-side and high-side signal pins, paired in order. */
export function shifterChannels(p: LibraryPart): { low: Pin; high: Pin }[] {
  const sig = p.pins.filter((x) => isSignalRole(x.role));
  const isLow = (x: Pin) => /^L/i.test(x.id) || /^LV/i.test(x.label) || (x.voltage !== undefined && x.voltage < 4);
  const isHigh = (x: Pin) => /^H/i.test(x.id) || /^HV/i.test(x.label) || (x.voltage !== undefined && x.voltage >= 4.5);
  const low = sig.filter((x) => isLow(x) && !isHigh(x));
  const high = sig.filter((x) => isHigh(x) && !isLow(x));
  const n = Math.min(low.length, high.length);
  return Array.from({ length: n }, (_, i) => ({ low: low[i], high: high[i] }));
}
