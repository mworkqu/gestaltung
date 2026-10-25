// Studio wiring, stage 3: buildNetlist() turns the resolved parts into nets
// (power, shared buses, one board pin per signal). Import from ./netlist.
//
// Pure and client-safe. Same input -> same output, byte for byte.

import type { Net, Pin, PinRole, ProductSpec, StudioComponent } from "./schema";
import { servoPlan } from "./servo-plan";
import {
  type Entry,
  type GetPart,
  driverSuits,
  entriesOf,
  isAnalog,
  isButton,
  isDriver,
  isInductive,
  isLowSideSwitch,
  isMcu,
  isPowerRole,
  loadPath,
  isPowerSource,
  isSeriesHelper,
  isShifter,
  isSignalRole,
  openByDesign,
  ref,
  shifterChannels,
  symbolKind,
  wantsPwm,
} from "./netlist-parts";
import {
  BUS_NET,
  type ShiftDir,
  isPeripheral,
  planPower,
  railFor,
  shiftNeed,
} from "./netlist-power";

// ── buildNetlist ────────────────────────────────────────────────────────────

class NetBook {
  private order: string[] = [];
  private pins = new Map<string, string[]>();
  private pinNet = new Map<string, string>();
  has(name: string) {
    return this.pins.has(name);
  }
  ensure(name: string) {
    if (!this.pins.has(name)) {
      this.pins.set(name, []);
      this.order.push(name);
    }
  }
  add(name: string, pinRef: string): boolean {
    if (this.pinNet.has(pinRef)) return false;
    this.ensure(name);
    this.pins.get(name)!.push(pinRef);
    this.pinNet.set(pinRef, name);
    return true;
  }
  netOf(pinRef: string) {
    return this.pinNet.get(pinRef);
  }
  /** `base`, or `base_2`, `base_3`… when taken. */
  fresh(base: string): string {
    if (!this.pins.has(base)) return base;
    let n = 2;
    while (this.pins.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }
  result(): Net[] {
    return this.order
      .map((name) => ({ name, pins: [...this.pins.get(name)!] }))
      .filter((n) => n.pins.length >= 2);
  }
}

type PinKind = "dout" | "din" | "din_pull" | "adc" | "pwm";

class PinPool {
  private used = new Set<string>();
  constructor(private mcu: Entry | undefined, private busy: { i2c: boolean; spi: boolean }) {}
  take(pinId: string) {
    this.used.add(pinId);
  }
  isFree(pinId: string) {
    return !this.used.has(pinId);
  }
  /** First free pin of `role`. */
  role(role: PinRole): Pin | undefined {
    const p = this.mcu?.p.pins.find((x) => x.role === role && !this.used.has(x.id));
    if (p) this.used.add(p.id);
    return p;
  }
  /** A free board pin for a signal, in the board's pin order, tiered by role. */
  alloc(kind: PinKind): Pin | undefined {
    if (!this.mcu) return undefined;
    const pins = this.mcu.p.pins;
    const hasPwm = pins.some((x) => x.role === "pwm");
    const spare: PinRole[] = [
      ...(this.busy.i2c ? [] : (["i2c_sda", "i2c_scl"] as PinRole[])),
      ...(this.busy.spi ? [] : (["spi_cs", "spi_sck", "spi_mosi", "spi_miso"] as PinRole[])),
    ];
    const tiers: PinRole[][] =
      kind === "adc" ? [["adc"]]
      : kind === "pwm" ? (hasPwm ? [["pwm"]] : [["gpio"], spare])
      : kind === "din" ? [["gpio"], ["pwm"], spare, ["adc"]]
      : [["gpio"], ["pwm"], spare];
    for (const tier of tiers) {
      const p = pins.find((x) => tier.includes(x.role) && !this.used.has(x.id));
      if (p) {
        this.used.add(p.id);
        return p;
      }
    }
    return undefined;
  }
}

const labelCode = (s: string) => s.toUpperCase().replace(/\(.*?\)/g, "").replace(/[^A-Z0-9]+/g, "") || "SIG";

/** Short net codes per instance: BTN1, LED1, PIR, DHT22, OLED2… */
function netCodes(entries: Entry[]): Map<string, { code: string; numbered: boolean }> {
  const base = (e: Entry) =>
    isButton(e.p) ? "BTN" : symbolKind(e.p) === "led" ? "LED" : labelCode(e.p.id.split("_").find((w) => w.length >= 3) ?? e.p.id);
  const count = new Map<string, number>();
  for (const e of entries) count.set(base(e), (count.get(base(e)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out = new Map<string, { code: string; numbered: boolean }>();
  for (const e of entries) {
    const b = base(e);
    const k = (seen.get(b) ?? 0) + 1;
    seen.set(b, k);
    const numbered = b === "BTN" || b === "LED";
    out.set(e.c.instanceId, { code: numbered || count.get(b)! > 1 ? `${b}${k}` : b, numbered });
  }
  return out;
}

export type BuildResult = {
  nets: Net[];
  /** Pin refs we could not connect (board out of pins, no suitable rail, no board). */
  unconnected: string[];
};

/**
 * Deterministic wiring. Power first (battery chain → board, board rails →
 * peripherals, every ground on GND), then buses (I2C/SPI shared, UART
 * crossed), then one free board pin per remaining signal, in the board's pin
 * order. Helpers in series (resistor) go between the board pin and their host.
 * `spec` is accepted for topology choices; the parts present decide today.
 */
export function buildNetlist(components: StudioComponent[], spec: ProductSpec, getPart: GetPart): BuildResult {
  const entries = entriesOf(components, getPart);
  const mcu = entries.find((e) => isMcu(e.p));
  const mcuLogic = mcu?.p.power.logicV ?? 3.3;
  const plan = planPower(entries, mcu);
  const nb = new NetBook();
  const unconnected: string[] = [];

  // Servos on a servo driver (servoPlan, Part E): each servo's 3-wire plug goes on its
  // channel (SIG → CH<n>_PWM, V+ → CH<n>_V, GND → CH<n>_GND); the driver's own power and
  // I2C pins are wired like any part below (VCC logic on 3V3, V+ terminal on the 5 V rail
  // the supply feeds, V− on GND). Its open channels and OE stay open on purpose.
  const sp = servoPlan(components, spec, getPart);
  const onDriver = new Set(sp?.driver ? sp.servos.filter((s) => s.channel !== null).map((s) => s.instanceId) : []);
  /** Pins this pass leaves to the servo-driver wiring (or open on purpose). */
  const servoSkip = (e: Entry, pin: Pin) => onDriver.has(e.c.instanceId) || openByDesign(e.p, pin);

  // Power nets in a fixed order.
  for (const s of plan.supply) for (const r of s.pins) nb.add(s.name, r);
  for (const key of ["3V3", "5V"] as const) {
    const rail = plan.rails[key];
    if (rail) nb.add(rail.net, rail.pin);
  }
  nb.ensure("GND");
  if (mcu) {
    const g = mcu.p.pins.find((x) => x.role === "gnd");
    if (g) nb.add("GND", ref(mcu.c.instanceId, g.id));
  }
  for (const r of plan.ground) nb.add("GND", r);

  // Pairings: series helpers to their hosts, drivers to their loads.
  const claimed = new Set<string>();
  const seriesOf = new Map<string, Entry[]>();
  for (const e of entries) {
    for (const req of e.p.requires ?? []) {
      const h = entries.find((x) => x.c.partId === req.id && !claimed.has(x.c.instanceId) && isSeriesHelper(x.p));
      if (!h) continue;
      claimed.add(h.c.instanceId);
      seriesOf.set(e.c.instanceId, [...(seriesOf.get(e.c.instanceId) ?? []), h]);
    }
  }
  const driverOf = new Map<string, Entry>();
  const loadOf = new Map<string, Entry>();
  for (const load of entries.filter((e) => isInductive(e.p))) {
    const open = (x: Entry) => isDriver(x.p) && !loadOf.has(x.c.instanceId);
    const d = entries.find((x) => open(x) && driverSuits(x.p, load.p)) ?? entries.find(open);
    if (!d) continue;
    driverOf.set(load.c.instanceId, d);
    loadOf.set(d.c.instanceId, load);
  }

  const loadTarget = (l: Entry) =>
    l.p.pins.find((x) => x.role === "in" || x.role === "gpio" || x.role === "pwm") ?? l.p.pins.find((x) => isPowerRole(x.role));

  /**
   * Loads switched by a LOW-SIDE module (F-007): the module interrupts the load's return, so
   * the load is a two-terminal path V+ → load → switched terminal. Its return must never
   * reach GND on its own, or the MOSFET switches nothing and the load runs permanently.
   */
  const lowSide = new Map<string, { driver: Entry; supply: Pin; ret: Pin }>();
  for (const [inst, d] of driverOf) {
    if (!isLowSideSwitch(d.p)) continue;
    const load = entries.find((x) => x.c.instanceId === inst);
    const path = load ? loadPath(load.p) : null;
    if (path) lowSide.set(inst, { driver: d, ...path });
  }

  // Peripherals and helpers: power pins and grounds.
  for (const e of entries) {
    if (isMcu(e.p) || isPowerSource(e.p)) continue;
    const ls = lowSide.get(e.c.instanceId);
    const driven = ls ? ls.ret : driverOf.has(e.c.instanceId) ? loadTarget(e) : undefined;
    for (const pin of e.p.pins) {
      const r = ref(e.c.instanceId, pin.id);
      // A low-side load's own two pins are wired below, as one path through the switch.
      if (pin === driven || (ls && pin === ls.supply) || servoSkip(e, pin)) continue;
      if (pin.role === "gnd") nb.add("GND", r);
      else if (isPowerRole(pin.role)) {
        const rail = railFor(pin, e.p, plan, mcuLogic);
        if (rail) nb.add(rail.net, r);
        else unconnected.push(r);
      }
    }
  }

  const peripherals = entries.filter((e) => isPeripheral(e) && !claimed.has(e.c.instanceId) && !onDriver.has(e.c.instanceId));
  const codes = netCodes(peripherals);

  // The low-side load path: the load's supply end joins the rail that feeds the module's own
  // load-power pin, its return end goes to the module's switched terminal (never to GND).
  for (const [inst, ls] of lowSide) {
    const vPlus = ls.driver.p.pins.find((x) => isPowerRole(x.role));
    const railNet = vPlus ? nb.netOf(ref(ls.driver.c.instanceId, vPlus.id)) : undefined;
    if (railNet) nb.add(railNet, ref(inst, ls.supply.id));
    else unconnected.push(ref(inst, ls.supply.id));
    const out = ls.driver.p.pins.find((x) => x.role === "out");
    if (!out) {
      unconnected.push(ref(inst, ls.ret.id));
      continue;
    }
    const code = codes.get(inst)?.code ?? "LOAD";
    const net = nb.fresh(`${code}_${labelCode(ls.ret.label.split(/[\s(/]/)[0] || ls.ret.id)}`);
    nb.add(net, ref(ls.driver.c.instanceId, out.id));
    nb.add(net, ref(inst, ls.ret.id));
  }

  const busy = {
    i2c: peripherals.some((e) => e.p.pins.some((x) => x.role === "i2c_sda" || x.role === "i2c_scl")),
    spi: peripherals.some((e) => e.p.pins.some((x) => x.role.startsWith("spi_"))),
  };
  const pool = new PinPool(mcu, busy);
  const busPins = new Map<string, string | null>();
  /** The MCU end of a shared bus line, allocated once (role pin, else a spare gpio). */
  const busEnd = (line: string, role: PinRole): string | null => {
    if (busPins.has(line)) return busPins.get(line)!;
    if (!mcu) return null;
    const p = pool.role(role) ?? pool.alloc(line === "MISO" ? "din" : "dout");
    const r = p ? ref(mcu.c.instanceId, p.id) : null;
    if (r) nb.add(line, r);
    busPins.set(line, r);
    return r;
  };

  type Pending = { mcuNet: string; dev: string; dir: ShiftDir };
  const pending: Pending[] = [];
  /** Attach a device pin to an MCU-side net, through a shifter when the levels differ. */
  const attach = (mcuNet: string, e: Entry, pin: Pin) => {
    const r = ref(e.c.instanceId, pin.id);
    const dir = mcu ? shiftNeed(e, pin, plan, mcuLogic) : null;
    if (dir) pending.push({ mcuNet, dev: r, dir });
    else nb.add(mcuNet, r);
  };
  /** A fresh net from a newly allocated board pin. */
  const fromBoard = (name: string, kind: PinKind): string | null => {
    if (!mcu) return null;
    const p = pool.alloc(kind);
    if (!p) return null;
    const net = nb.fresh(name);
    nb.add(net, ref(mcu.c.instanceId, p.id));
    return net;
  };

  for (const e of peripherals) {
    const inst = e.c.instanceId;
    const { code, numbered } = codes.get(inst)!;
    const signals = e.p.pins.filter((x) => isSignalRole(x.role) && !openByDesign(e.p, x));
    const nameFor = (pin: Pin) =>
      numbered && signals.length === 1 ? code : `${code}_${labelCode(pin.label.split(/[\s(/]/)[0] || pin.id)}`;

    // A button: one leg to a board pin (internal pull-up), the other to GND.
    if (isButton(e.p)) {
      const sig = signals.find((x) => x.role === "out") ?? signals[0];
      for (const pin of signals) {
        if (pin !== sig) nb.add("GND", ref(inst, pin.id));
      }
      if (sig) {
        const net = fromBoard(numbered ? code : `${code}_${labelCode(sig.id)}`, "din_pull");
        if (net) nb.add(net, ref(inst, sig.id));
        else unconnected.push(ref(inst, sig.id));
      }
      continue;
    }

    const helpers = seriesOf.get(inst) ?? [];
    const load = loadOf.get(inst);
    const driver = driverOf.get(inst);
    let seriesDone = false;

    for (const pin of signals) {
      const r = ref(inst, pin.id);
      if (nb.netOf(r)) continue;
      // A driver's output goes to its load.
      if (load && (pin.role === "out")) {
        const t = loadTarget(load);
        if (t) {
          const net = nb.fresh(`${codes.get(load.c.instanceId)?.code ?? "LOAD"}_${labelCode(t.label.split(/[\s(/]/)[0] || t.id)}`);
          nb.add(net, r);
          nb.add(net, ref(load.c.instanceId, t.id));
          continue;
        }
      }
      // A load's input comes from its driver (wired above or below).
      if (driver) {
        const t = loadTarget(e);
        if (t && t.id === pin.id) continue;
      }
      // Buses.
      const line = BUS_NET[pin.role];
      if (line) {
        const end = busEnd(line, pin.role);
        if (end) attach(nb.netOf(end)!, e, pin);
        else unconnected.push(r);
        continue;
      }
      if (pin.role === "uart_tx" || pin.role === "uart_rx") {
        const mp = mcu ? pool.role(pin.role === "uart_tx" ? "uart_rx" : "uart_tx") ?? pool.alloc(pin.role === "uart_tx" ? "din" : "dout") : undefined;
        if (!mp || !mcu) {
          unconnected.push(r);
          continue;
        }
        const net = nb.fresh(nameFor(pin));
        nb.add(net, ref(mcu.c.instanceId, mp.id));
        attach(net, e, pin);
        continue;
      }
      const kind: PinKind =
        pin.role === "adc" ? "adc"
        : pin.role === "pwm" ? "pwm"
        : pin.role === "out" ? (isAnalog(e.p) ? "adc" : "din")
        : pin.role === "in" || pin.role === "gpio" ? (wantsPwm(e.p) ? "pwm" : "dout")
        : "dout"; // spi_cs and anything else the board drives
      const name = nameFor(pin);
      const net = fromBoard(name, kind);
      if (!net) {
        unconnected.push(r);
        continue;
      }
      // Series helpers (resistor) between the board pin and the host's first signal pin.
      if (!seriesDone && helpers.length) {
        seriesDone = true;
        let cur = net;
        helpers.forEach((h, i) => {
          const [a, b] = h.p.pins;
          nb.add(cur, ref(h.c.instanceId, a.id));
          cur = nb.fresh(i === helpers.length - 1 ? `${net}_${labelCode(pin.id)}` : `${net}_${i + 2}`);
          nb.add(cur, ref(h.c.instanceId, b.id));
        });
        nb.add(cur, r);
        continue;
      }
      attach(net, e, pin);
    }
  }

  // Servo plugs on the driver's channels, one 3-wire plug per servo (servo order = channel order).
  const drv = sp?.driver ? entries.find((e) => e.c.instanceId === sp.driver) : undefined;
  if (drv && sp) {
    sp.servos.forEach((s, i) => {
      if (s.channel === null) return;
      const servo = entries.find((e) => e.c.instanceId === s.instanceId);
      if (!servo) return;
      const code = `SERVO${i + 1}`;
      const plug: [string, PinRole, string][] = [
        [code, "pwm", "PWM"],
        [`${code}_V`, "5v", "V"],
        [`${code}_GND`, "gnd", "GND"],
      ];
      for (const [net, role, suffix] of plug) {
        const dp = drv.p.pins.find((x) => x.id === `CH${s.channel}_${suffix}`);
        const sv = servo.p.pins.find((x) => x.role === role) ?? (role === "pwm" ? servo.p.pins.find((x) => isSignalRole(x.role)) : undefined);
        if (!dp || !sv) {
          if (sv) unconnected.push(ref(servo.c.instanceId, sv.id));
          continue;
        }
        const name = nb.fresh(net);
        nb.add(name, ref(drv.c.instanceId, dp.id));
        nb.add(name, ref(servo.c.instanceId, sv.id));
      }
    });
  }

  // Level shifters: one channel per MCU-side net; spare devices go direct (and are flagged by the checks).
  const shifters = entries.filter((e) => isShifter(e.p));
  const channels = shifters.flatMap((s) => shifterChannels(s.p).map((ch) => ({ s, ...ch })));
  const groups: { mcuNet: string; dir: ShiftDir; devs: string[] }[] = [];
  for (const p of pending) {
    const g = groups.find((x) => x.mcuNet === p.mcuNet);
    if (g) g.devs.push(p.dev);
    else groups.push({ mcuNet: p.mcuNet, dir: p.dir, devs: [p.dev] });
  }
  for (const g of groups) {
    const ch = channels.shift();
    if (!ch) {
      for (const d of g.devs) nb.add(g.mcuNet, d);
      continue;
    }
    const s = ch.s.c.instanceId;
    const devNet = nb.fresh(`${g.mcuNet}_${g.dir === "dev_to_mcu" ? "5V" : "3V3"}`);
    const mcuSide = g.dir === "dev_to_mcu" ? ch.low : ch.high;
    const devSide = g.dir === "dev_to_mcu" ? ch.high : ch.low;
    nb.add(g.mcuNet, ref(s, mcuSide.id));
    nb.add(devNet, ref(s, devSide.id));
    for (const d of g.devs) nb.add(devNet, d);
  }

  // Anything a peripheral still has open that should have been wired.
  for (const e of [...peripherals, ...entries.filter((x) => onDriver.has(x.c.instanceId))]) {
    for (const pin of e.p.pins) {
      const r = ref(e.c.instanceId, pin.id);
      if (openByDesign(e.p, pin)) continue;
      if (!nb.netOf(r) && !unconnected.includes(r)) unconnected.push(r);
    }
  }
  return { nets: nb.result(), unconnected };
}
