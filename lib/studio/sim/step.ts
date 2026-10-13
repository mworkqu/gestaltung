// "Try it" simulation (P5-17g) — the clock: step(model, state, inputs, dt).
//
// Pure and deterministic: the same model, inputs and dt sequence always give
// the same states (tests check it). The UI ticks it at SIM_HZ (20 Hz).
//
// The primary input (model.primary) decides "active" + a level 0..1; every
// output follows it through the rule table (model.ts RULES / outMode). Button
// behaviour comes from the outputs: a feeder's servo turns 90° and back
// (pulse), a doorbell's buzzer + light run for a moment (ring), a lamp toggles
// (toggle), anything else runs while held (hold).
//
// activeWires() says which Connection ids carry a signal right now: the
// non-power wires to an output that is on (one hop through a driver such as a
// motor driver), and a sensor's signal wire for a moment after its value moved.

import type { Connection } from "../connections";
import {
  RING_HEX,
  outMode,
  type InputKind,
  type OutputKind,
  type RingColour,
  type SimControl,
  type SimModel,
} from "./model";

/** Seconds a doorbell press keeps ringing. */
export const RING_SECONDS = 2;
/** Seconds the feeder's servo stays open before it turns back. */
export const PULSE_SECONDS = 1.5;
/** Servo speed (degrees per second). */
export const SERVO_DEG_PER_S = 240;
/** Seconds a sensor's wire stays lit after its value changed. */
export const SENSOR_FLASH_S = 0.6;

export type SimInputs = {
  /** Value per control id (toggle / hold: 0 or 1). */
  values: Record<string, number>;
  /** Threshold per control id (when the control has one). */
  thresholds: Record<string, number>;
  /** Press count per hold control: a press shorter than one tick still counts. */
  presses: Record<string, number>;
};

export type OutputState = {
  id: string;
  kind: OutputKind;
  on: boolean;
  /** Brightness / speed 0..1. */
  level: number;
  /** Ring / LED colour (hex). */
  colour?: string;
  colourName?: RingColour;
  /** Ring pixels lit. */
  pixels?: number;
  /** Servo angle now (degrees) and where it is going. */
  angle?: number;
  /** A joint servo (Part E): it follows its own slider, not the inputs. */
  joint?: boolean;
  target?: number;
  /** Beeps per second (buzzer / speaker). */
  beepHz?: number;
};

export type Cause =
  | "soilDry" | "soilWet" | "hot" | "cool" | "humid" | "dryAir" | "motion" | "noMotion"
  | "near" | "far" | "dark" | "bright" | "switchedOn" | "switchedOff" | "bellPressed"
  | "feeding" | "pressed" | "waiting" | "knob" | "tilted" | "level" | "night" | "day" | "none"
  | "jointMoving" | "jointStill";

export type SimState = {
  t: number;
  prev: Record<string, number>;
  changedAt: Record<string, number>;
  pressSeen: Record<string, number>;
  /** Motion / doorbell: on until this time. */
  holdUntil: number;
  /** Lamp toggle. */
  latched: boolean;
  /** Feeder pulse start (null = none running). */
  pulseStart: number | null;
  servo: Record<string, number>;
  active: boolean;
  level: number;
  cause: Cause;
  /** The primary input's value now (for the screen / status). */
  reading: number | null;
  outputs: OutputState[];
};

export function initialInputs(model: SimModel): SimInputs {
  const values: Record<string, number> = {};
  const thresholds: Record<string, number> = {};
  const presses: Record<string, number> = {};
  for (const c of model.controls) {
    values[c.id] = c.initial;
    if (c.threshold) thresholds[c.id] = c.threshold.value;
    if (c.type === "hold") presses[c.id] = 0;
  }
  return { values, thresholds, presses };
}

export function initialState(model: SimModel, inputs: SimInputs = initialInputs(model)): SimState {
  const blank: SimState = {
    t: 0,
    prev: { ...inputs.values },
    changedAt: {},
    pressSeen: { ...inputs.presses },
    holdUntil: -1,
    latched: false,
    pulseStart: null,
    // A joint servo starts where its slider is (nothing moves until the slider does).
    servo: Object.fromEntries(
      model.outputs.filter((o) => o.kind === "servo").map((o) => {
        const j = model.controls.find((c) => c.kind === "joint" && c.servo === o.id);
        return [o.id, j ? valueOf(j, inputs) : 0];
      }),
    ),
    active: false,
    level: 0,
    cause: "none",
    reading: null,
    outputs: [],
  };
  return step(model, blank, inputs, 0);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

function valueOf(c: SimControl, inputs: SimInputs): number {
  const v = inputs.values[c.id];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(c.min, Math.min(c.max, v)) : c.initial;
}
function thresholdOf(c: SimControl, inputs: SimInputs): number {
  const th = c.threshold;
  if (!th) return 0;
  const v = inputs.thresholds[c.id];
  return typeof v === "number" && Number.isFinite(v) ? Math.max(th.min, Math.min(th.max, v)) : th.value;
}

export function step(model: SimModel, state: SimState, inputs: SimInputs, dt: number): SimState {
  const t = round1000(state.t + Math.max(0, dt));
  const prev = { ...state.prev };
  const changedAt = { ...state.changedAt };
  const pressSeen = { ...state.pressSeen };
  const edges = new Set<string>();
  for (const c of model.controls) {
    const v = valueOf(c, inputs);
    const was = prev[c.id] ?? c.initial;
    if (v !== was) changedAt[c.id] = t;
    if (c.type === "hold") {
      const n = inputs.presses[c.id] ?? 0;
      if (n > (pressSeen[c.id] ?? 0) || (v >= 0.5 && was < 0.5)) {
        edges.add(c.id);
        changedAt[c.id] = t;
      }
      pressSeen[c.id] = Math.max(n, pressSeen[c.id] ?? 0);
    }
    prev[c.id] = v;
  }

  let { holdUntil, latched, pulseStart } = state;
  let active = false;
  let level = 1;
  let cause: Cause = "none";
  let reading: number | null = null;
  const p = model.controls.find((c) => c.id === model.primary) ?? null;
  const kind: InputKind | null = p?.kind ?? null;

  if (p) {
    const v = valueOf(p, inputs);
    const th = thresholdOf(p, inputs);
    reading = v;
    switch (p.kind) {
      case "soil":
        active = v > th;
        cause = active ? "soilDry" : "soilWet";
        break;
      case "temperature":
        active = v > th;
        cause = active ? "hot" : "cool";
        break;
      case "humidity":
        active = v > th;
        cause = active ? "humid" : "dryAir";
        break;
      case "motion":
        if (v >= 0.5) holdUntil = t + th;
        active = v >= 0.5 || t < holdUntil;
        cause = active ? "motion" : "noMotion";
        break;
      case "distance":
        active = v < th;
        level = active ? clamp01(1 - v / th) : 0;
        cause = active ? "near" : "far";
        break;
      case "light":
        active = v < th;
        cause = active ? "dark" : "bright";
        break;
      case "button":
      case "touch": {
        const pressed = v >= 0.5;
        const edge = edges.has(p.id);
        if (model.buttonMode === "toggle") {
          if (edge) latched = !latched;
          active = latched;
          cause = latched ? "switchedOn" : edge || state.cause === "switchedOn" || state.cause === "switchedOff" ? "switchedOff" : "waiting";
        } else if (model.buttonMode === "ring") {
          if (edge) holdUntil = t + RING_SECONDS;
          active = pressed || t < holdUntil;
          cause = active ? "bellPressed" : "waiting";
        } else if (model.buttonMode === "pulse") {
          if (edge && pulseStart === null) pulseStart = t;
          // Open for a moment after a press, and for as long as it is held.
          active = pulseStart !== null && (pressed || t - pulseStart < PULSE_SECONDS);
          cause = pulseStart !== null ? "feeding" : "waiting";
        } else {
          active = pressed;
          cause = pressed ? "pressed" : "waiting";
        }
        break;
      }
      case "knob":
        level = clamp01((v - p.min) / (p.max - p.min));
        active = level > 0.02;
        cause = "knob";
        break;
      case "tilt":
        active = Math.abs(v) > th;
        level = clamp01(Math.abs(v) / 90);
        cause = active ? "tilted" : "level";
        break;
      case "time":
        active = v >= th || v < 6;
        cause = active ? "night" : "day";
        break;
      case "power":
        active = v >= 0.5;
        cause = active ? "switchedOn" : "switchedOff";
        break;
    }
  }

  const servo = { ...state.servo };
  let servoBusy = false;
  let jointsMoving = false;
  const ringHex = RING_HEX[model.ring];
  const outputs: OutputState[] = model.outputs.map((o) => {
    const mode = outMode(kind, o.kind);
    const lvl = mode === "level" ? level : 1;
    switch (o.kind) {
      case "led":
        return { id: o.id, kind: o.kind, on: active, level: active ? round1(lvl) : 0, colour: o.colour ?? "#ff3b30" };
      case "ring": {
        const n = o.pixels ?? 12;
        const lit = active ? (mode === "level" ? Math.max(1, Math.round(level * n)) : n) : 0;
        return { id: o.id, kind: o.kind, on: active, level: active ? 1 : 0, colour: ringHex, colourName: model.ring, pixels: lit };
      }
      case "pump":
      case "motor":
        return { id: o.id, kind: o.kind, on: active, level: active ? round1(lvl) : 0 };
      case "servo": {
        const joint = model.controls.find((c) => c.kind === "joint" && c.servo === o.id);
        if (joint) {
          const target = valueOf(joint, inputs);
          const cur = servo[o.id] ?? target;
          const maxStep = SERVO_DEG_PER_S * Math.max(0, dt);
          const next = Math.abs(target - cur) <= maxStep ? target : cur + Math.sign(target - cur) * maxStep;
          servo[o.id] = round1(next);
          if (servo[o.id] !== target) jointsMoving = true;
          // "On" (its wire lit) only while it turns.
          return { id: o.id, kind: o.kind, on: servo[o.id] !== target, level: 1, angle: servo[o.id], target, joint: true };
        }
        let target = active ? 90 : 0;
        if (mode === "angle" && p) {
          const v = valueOf(p, inputs);
          target = p.kind === "tilt" ? Math.max(0, Math.min(180, v + 90)) : Math.round(level * 180);
        }
        const cur = servo[o.id] ?? 0;
        const maxStep = SERVO_DEG_PER_S * Math.max(0, dt);
        const next = Math.abs(target - cur) <= maxStep ? target : cur + Math.sign(target - cur) * maxStep;
        servo[o.id] = round1(next);
        if (servo[o.id] !== target) servoBusy = true;
        return { id: o.id, kind: o.kind, on: servo[o.id] > 0.5 || servo[o.id] !== target, level: 1, angle: servo[o.id], target };
      }
      case "buzzer":
      case "speaker": {
        const hz = mode === "rate" ? 1 + 7 * level : model.buttonMode === "ring" && (kind === "button" || kind === "touch") ? 3 : 2;
        return { id: o.id, kind: o.kind, on: active, level: active ? 1 : 0, beepHz: active ? round1(hz) : 0 };
      }
      case "relay":
        return { id: o.id, kind: o.kind, on: active, level: active ? 1 : 0 };
      case "screen":
        return { id: o.id, kind: o.kind, on: true, level: 1 };
    }
  });

  // The feeder's pulse ends once the servo is back home.
  const held = !!p && (p.kind === "button" || p.kind === "touch") && valueOf(p, inputs) >= 0.5;
  if (pulseStart !== null && t - pulseStart >= PULSE_SECONDS && !servoBusy && !held) pulseStart = null;
  if (model.buttonMode === "pulse" && pulseStart === null && cause === "feeding") cause = "waiting";
  // An arm with nothing else to react to: say what its joints do.
  if (!p && model.controls.some((c) => c.kind === "joint")) cause = jointsMoving ? "jointMoving" : "jointStill";

  return { t, prev, changedAt, pressSeen, holdUntil, latched, pulseStart, servo, active, level: round1(level), cause, reading, outputs };
}

function round1000(v: number) {
  return Math.round(v * 1000) / 1000;
}

// ── Reading the state ───────────────────────────────────────────────────────

/** "pump:on,ring:on,servo:90" — for tests and the panel's data attribute. */
export function outputsAttr(state: SimState): string {
  return state.outputs
    .filter((o) => o.kind !== "screen")
    .map((o) => `${o.kind}:${o.kind === "servo" ? Math.round(o.angle ?? 0) : o.on ? "on" : "off"}`)
    .join(",");
}

/** Something on screen keeps moving (spinning, beeping, flowing, a servo on its way). */
export function isMoving(state: SimState): boolean {
  if (state.outputs.some((o) => o.kind !== "screen" && o.on)) return true;
  return Object.values(state.changedAt).some((at) => state.t - at < SENSOR_FLASH_S);
}

/** Changes only when something a person can see changes (re-render key for the UI). */
export function signature(state: SimState): string {
  const outs = state.outputs.map((o) => `${o.id}=${o.on ? 1 : 0}/${o.level}/${o.pixels ?? ""}/${o.angle ?? ""}/${o.beepHz ?? ""}`).join(";");
  const flash = Object.entries(state.changedAt)
    .filter(([, at]) => state.t - at < SENSOR_FLASH_S)
    .map(([id]) => id)
    .join(",");
  return `${state.cause}|${state.reading}|${outs}|${flash}`;
}

const QUIET_ROLES = new Set(["power", "ground"]);

/** Connection ids carrying a signal right now. */
export function activeWires(model: SimModel, state: SimState, connections: Connection[]): Set<string> {
  const out = new Set<string>();
  const ends = (c: Connection) => [c.from.part, c.to.part, c.viaPart].filter((x): x is string => !!x);
  const signal = connections.filter((c) => !QUIET_ROLES.has(c.role));
  const boards = new Set(model.boards);
  const on = new Set(state.outputs.filter((o) => o.kind !== "screen" && o.on).map((o) => o.id));
  // Recently changed sensors light their own signal wires (and a screen shows the new reading).
  const flashing = new Set(
    model.controls.filter((c) => c.part && state.t - (state.changedAt[c.id] ?? -Infinity) < SENSOR_FLASH_S).map((c) => c.part!),
  );
  if (flashing.size) for (const o of state.outputs) if (o.kind === "screen") on.add(o.id);
  // One hop: a driver between the board and an output that is on.
  const hop = new Set<string>();
  for (const c of signal) {
    const e = ends(c);
    if (!e.some((x) => on.has(x))) continue;
    out.add(c.id);
    for (const x of e) if (!on.has(x) && !boards.has(x)) hop.add(x);
  }
  for (const c of signal) {
    const e = ends(c);
    if (e.some((x) => hop.has(x) || flashing.has(x))) out.add(c.id);
  }
  return out;
}

/** Plain-language pieces of the status line (the UI words them per locale). */
export type Effect = { kind: OutputKind; on: boolean; colourName?: RingColour; angle?: number };

export function effects(state: SimState): Effect[] {
  const seen = new Set<OutputKind>();
  const out: Effect[] = [];
  for (const o of state.outputs) {
    // Joint servos show their angle on their own slider.
    if (o.kind === "screen" || o.joint || seen.has(o.kind)) continue;
    seen.add(o.kind);
    out.push({
      kind: o.kind,
      on: o.on,
      ...(o.colourName ? { colourName: o.colourName } : {}),
      ...(o.kind === "servo" ? { angle: Math.round(o.target ?? o.angle ?? 0) } : {}),
    });
  }
  return out;
}

