// Part D: deterministic actuator rules applied after the model's part pick (like
// POWER_PARTS / enforceSinglePower in pick.ts). Pure: works on a plain {partId, label}
// list and the library index; every change is logged.
//
//  1. Servo count = the sum of spec.actuators servo groups (top up / trim the model's
//     list). heavy/medium → MG996R, light → SG90. An arm whose groups carry no different
//     loads: base/shoulder/elbow (the first 3) MG996R, wrist/gripper (the rest) SG90 —
//     a 6-axis arm is 3 MG996R + 3 SG90.
//  2. Pumps / motors: pump_5v / n20_motor count = the sum of those groups (only when the
//     spec gives one; no actuators = the model's list as before). Steppers: no library
//     part yet, left to the model.
//  3. ≥ 3 servos, or more servos than free PWM pins on the board → add the PCA9685
//     servo driver (I2C; servos sit on its channels).
//  4. Total servo STALL current over what the supply can give (no supply part = the
//     board's USB port, 500 mA) → the 5 V / 5 A wall supply replaces the other supply
//     boards and batteries. Servos are powered from that supply's 5 V through the
//     PCA9685 V+ terminal, never from the board's 5V pin (see servoPlan(), Part E).
//  5. Over the pin budget with no driver in the library → the board with the most
//     free PWM pins replaces the mcu (an ESP32-C3 mini can't run them alone).

import { LIMITS, type ClampLog, type Pin, type PinRole, type ProductSpec } from "../schema";

export const SERVO_STRONG = "mg996r_servo";
export const SERVO_LIGHT = "sg90_servo";
export const SERVO_IDS: ReadonlySet<string> = new Set([SERVO_STRONG, SERVO_LIGHT]);
export const SERVO_DRIVER = "pca9685_servo";
export const BIG_SUPPLY = "psu_5v_5a";
export const PUMP_ID = "pump_5v";
export const MOTOR_ID = "n20_motor";
/** What a board's own USB port gives when no supply part is picked (mA). */
export const USB_PORT_MA = 500;
/** At most this many of one part (= the largest actuator group). */
export const MAX_PER_PART = LIMITS.actuators.countMax;
/** The arm joints that get the strong servo when the spec gives no per-joint loads. */
export const ARM_STRONG_JOINTS = 3;

/** Wall / USB supply boards (a power source in their own right). */
export const SUPPLY_BOARD_IDS: ReadonlySet<string> = new Set(["usbc_power_5v", BIG_SUPPLY]);
const BATTERY_IDS = new Set(["cell_18650", "lipo_1000", "aa_holder_2"]);
const CHARGER_IDS = new Set(["tp4056_usbc"]);

export type Slot = { partId: string; label: string };

/** The index fields the rules read (id, category, tags, power). */
export type RuleIndexEntry = {
  id: string;
  category: string;
  tags?: readonly string[];
  power?: unknown;
};

export type RuleOpts = {
  spec: ProductSpec;
  byId: ReadonlyMap<string, RuleIndexEntry>;
  log: ClampLog;
  /** Display label for a part the rules add. */
  name: (id: string) => string;
  /** The library's pins for a part id (pin budget). Without it only the "≥ 3 servos" rule adds the driver. */
  pinsOf?: (id: string) => readonly Pin[] | undefined;
};

const ARM_RE = /\barms?\b|robot(?:ic)? arm|gripper|ذراع/i;

function powerOf(e: RuleIndexEntry | undefined): { mA: number; supplyMA?: number } {
  const p = e?.power;
  if (!p || typeof p !== "object") return { mA: 0 };
  const o = p as Record<string, unknown>;
  return {
    mA: typeof o.mA === "number" && Number.isFinite(o.mA) ? o.mA : 0,
    ...(typeof o.supplyMA === "number" && o.supplyMA > 0 ? { supplyMA: o.supplyMA } : {}),
  };
}

const sumOf = (spec: ProductSpec, kind: string) =>
  (spec.actuators ?? []).filter((a) => a.kind === kind).reduce((s, a) => s + a.count, 0);

/** How many strong (MG996R) and light (SG90) servos the spec asks for; null = it gives no servo count. */
export function servoMix(spec: ProductSpec): { strong: number; light: number } | null {
  const groups = (spec.actuators ?? []).filter((a) => a.kind === "servo");
  if (!groups.length) return null;
  const total = Math.min(MAX_PER_PART, groups.reduce((s, a) => s + a.count, 0));
  const text = [spec.name, spec.oneLine, ...spec.features, ...groups.map((g) => g.role ?? "")].join(" . ");
  const oneLoad = new Set(groups.map((g) => g.load)).size === 1;
  if (oneLoad && ARM_RE.test(text) && total > ARM_STRONG_JOINTS) {
    return { strong: ARM_STRONG_JOINTS, light: total - ARM_STRONG_JOINTS };
  }
  let strong = groups.filter((g) => g.load !== "light").reduce((s, a) => s + a.count, 0);
  let light = groups.filter((g) => g.load === "light").reduce((s, a) => s + a.count, 0);
  // Never more than 8 servos in all: trim the light ones first.
  while (strong + light > MAX_PER_PART) {
    if (light > 0) light--;
    else strong--;
  }
  return { strong, light };
}

const isMcu = (byId: RuleOpts["byId"], s: Slot) => byId.get(s.partId)?.category === "mcu";

/** Where added parts go: right after a leading mcu, so the cap never drops them. */
const insertAt = (list: readonly Slot[], byId: RuleOpts["byId"]) => (list.length && isMcu(byId, list[0]) ? 1 : 0);

/** Exactly `want` copies of each id in `ids` (keeps the model's label; new copies next to the first). */
function setCounts(list: Slot[], want: Record<string, number>, o: RuleOpts, path: string): Slot[] {
  const ids = Object.keys(want);
  const before = Object.fromEntries(ids.map((id) => [id, list.filter((s) => s.partId === id).length]));
  if (ids.every((id) => before[id] === want[id])) return list;
  const label = (id: string) => list.find((s) => s.partId === id)?.label || o.name(id);
  const firstIdx = list.findIndex((s) => ids.includes(s.partId));
  const kept = list.filter((s) => !ids.includes(s.partId));
  const at = firstIdx >= 0 ? list.slice(0, firstIdx).filter((s) => !ids.includes(s.partId)).length : insertAt(kept, o.byId);
  const group: Slot[] = ids.flatMap((id) => Array.from({ length: want[id] }, () => ({ partId: id, label: label(id) })));
  o.log.push({ path, from: before, to: want });
  return [...kept.slice(0, at), ...group, ...kept.slice(at)];
}

// ── Pin budget (approximate, mirrors netlist.ts PinPool tiers) ──────────────

const SIGNAL_ROLES: ReadonlySet<PinRole> = new Set(["in", "out", "gpio", "pwm", "adc", "uart_tx", "uart_rx"]);
const I2C: ReadonlySet<PinRole> = new Set(["i2c_sda", "i2c_scl"]);
const SPI: ReadonlySet<PinRole> = new Set(["spi_mosi", "spi_miso", "spi_sck", "spi_cs"]);

/**
 * Board pins left for servo signals once the other parts are wired. A board with
 * pwm-role pins (Uno, Nano) drives servos only from those; an ESP32 / Pico from any
 * gpio plus the spare I2C/SPI pins. Servos, the driver and power parts are not "other".
 */
export function freePwmPins(mcuId: string, others: readonly Slot[], o: Pick<RuleOpts, "byId" | "pinsOf">): number {
  const pins = o.pinsOf?.(mcuId) ?? [];
  const count = (r: PinRole) => pins.filter((p) => p.role === r).length;
  let signals = 0;
  let pwmWanted = 0;
  let i2c = false;
  let spi = false;
  for (const s of others) {
    const e = o.byId.get(s.partId);
    if (!e || e.category === "mcu" || e.category === "power" || SERVO_IDS.has(s.partId) || s.partId === SERVO_DRIVER) continue;
    for (const p of o.pinsOf?.(s.partId) ?? []) {
      if (I2C.has(p.role)) i2c = true;
      else if (SPI.has(p.role)) spi = true;
      else if (p.role === "pwm") pwmWanted++;
      else if (SIGNAL_ROLES.has(p.role)) signals++;
    }
  }
  const spare = (i2c ? 0 : count("i2c_sda") + count("i2c_scl")) + (spi ? 0 : SPI_COUNT(pins));
  const gpio = count("gpio");
  const pwm = count("pwm");
  if (pwm > 0) {
    // Plain signals use gpio, then pwm pins (PinPool order), then spare pins.
    const spill = Math.max(0, signals - gpio - spare);
    return Math.max(0, pwm - pwmWanted - spill);
  }
  return Math.max(0, gpio + spare - signals - pwmWanted);
}
const SPI_COUNT = (pins: readonly Pin[]) => pins.filter((p) => SPI.has(p.role)).length;

// ── The rules ───────────────────────────────────────────────────────────────

export function applyActuatorRules(input: readonly Slot[], o: RuleOpts): Slot[] {
  const { spec, byId, log } = o;
  let list = [...input];

  // 1. Servo count and size from spec.actuators.
  const mix = servoMix(spec);
  if (mix) {
    let { strong, light } = mix;
    if (!byId.has(SERVO_STRONG)) [strong, light] = [0, strong + light];
    if (!byId.has(SERVO_LIGHT)) [strong, light] = [strong + light, 0];
    const want: Record<string, number> = {};
    if (byId.has(SERVO_STRONG)) want[SERVO_STRONG] = strong;
    if (byId.has(SERVO_LIGHT)) want[SERVO_LIGHT] = light;
    list = setCounts(list, want, o, "components.servo");
  }

  // 2. Pumps / motors the spec counts.
  for (const [kind, id] of [["pump", PUMP_ID], ["motor", MOTOR_ID]] as const) {
    const n = Math.min(MAX_PER_PART, sumOf(spec, kind));
    if (n > 0 && byId.has(id)) list = setCounts(list, { [id]: n }, o, `components.${kind}`);
  }

  const servos = list.filter((s) => SERVO_IDS.has(s.partId));
  if (!servos.length) return list;
  const n = servos.length;
  const mcuOf = () => list.find((s) => isMcu(byId, s));
  const others = () => list.filter((s) => !SERVO_IDS.has(s.partId));
  const pinShort = () => {
    const mcu = mcuOf();
    return Boolean(o.pinsOf && mcu && n > freePwmPins(mcu.partId, others(), o));
  };

  // 3. The servo driver.
  const hasDriver = () => list.some((s) => s.partId === SERVO_DRIVER);
  if (!hasDriver() && byId.has(SERVO_DRIVER) && (n >= 3 || pinShort())) {
    const at = list.findIndex((s) => SERVO_IDS.has(s.partId));
    list.splice(at, 0, { partId: SERVO_DRIVER, label: o.name(SERVO_DRIVER) });
    log.push({ path: "components.servo_driver", from: null, to: SERVO_DRIVER });
  }

  // 5. No driver and the board can't drive them all: the board with the most free PWM pins.
  if (!hasDriver() && pinShort() && o.pinsOf) {
    const mcu = mcuOf()!;
    const best = [...byId.values()]
      .filter((e) => e.category === "mcu")
      .map((e) => ({ id: e.id, free: freePwmPins(e.id, others(), o) }))
      .sort((a, b) => b.free - a.free)[0];
    if (best && best.id !== mcu.partId && best.free >= n) {
      list = list.map((s) => (s === mcu ? { partId: best.id, label: o.name(best.id) } : s));
      log.push({ path: "components.mcu.pins", from: mcu.partId, to: best.id });
    }
  }

  // 4. Servo power: the stall current must fit the supply.
  const stall = servos.reduce((s, x) => s + powerOf(byId.get(x.partId)).mA, 0);
  const capacity = Math.max(USB_PORT_MA, ...list.map((s) => powerOf(byId.get(s.partId)).supplyMA ?? 0));
  if (stall > capacity && byId.has(BIG_SUPPLY) && !list.some((s) => s.partId === BIG_SUPPLY)) {
    const gone = list.filter((s) => SUPPLY_BOARD_IDS.has(s.partId) || BATTERY_IDS.has(s.partId) || CHARGER_IDS.has(s.partId));
    list = list.filter((s) => !gone.includes(s));
    list.splice(insertAt(list, byId), 0, { partId: BIG_SUPPLY, label: o.name(BIG_SUPPLY) });
    log.push({ path: "components.servo_power", from: { stallMA: stall, capacityMA: capacity, removed: gone.map((g) => g.partId) }, to: BIG_SUPPLY });
  }
  return list;
}

/**
 * The cap: at most `max` KINDS of part (identical parts are one slot: 6 servos = 1),
 * and at most MAX_PER_PART of one part. Later kinds go first; every cut is logged.
 */
export function capKinds(list: readonly Slot[], max: number, log: ClampLog): Slot[] {
  const kinds: string[] = [];
  const per = new Map<string, number>();
  const out: Slot[] = [];
  let droppedCopies = 0;
  for (const s of list) {
    if (!kinds.includes(s.partId)) {
      if (kinds.length >= max) continue;
      kinds.push(s.partId);
    }
    const n = (per.get(s.partId) ?? 0) + 1;
    if (n > MAX_PER_PART) {
      droppedCopies++;
      continue;
    }
    per.set(s.partId, n);
    out.push(s);
  }
  const allKinds = new Set(list.map((s) => s.partId)).size;
  if (allKinds > max) log.push({ path: "components", from: allKinds, to: max });
  if (droppedCopies) log.push({ path: "components.copies", from: droppedCopies, to: `max ${MAX_PER_PART} of one part` });
  return out;
}
