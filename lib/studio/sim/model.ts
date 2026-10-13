// "Try it" simulation (P5-17g) — what the client can play with and what moves.
//
// A preview of how the product BEHAVES, from its spec + parts, never from the
// real compiled code (the UI says so). Free: no AI, no server, no credits.
//
//  * simModel(doc, getPart) → the controls (one per INPUT part: a soil probe
//    gives "Soil: wet ↔ dry", a PIR a "Motion" toggle …), the outputs (LED,
//    ring, pump, motor, servo, buzzer, speaker, relay, screen) and which input
//    drives them (the primary input) with the button behaviour (lamp toggle /
//    doorbell ring / feeder pulse / hold).
//  * RULES = the rule table: input kind → trigger, threshold, ring colour, and
//    per output kind how it follows (OUT_MODES, default "follow" = input
//    active → output on). Unknown combinations fall back to "follow".
//  * Joints (Part E): servos on a servo driver (a robot arm) are not driven by
//     an input — each gets its own "joint" slider (0–180°) and turns to it. The
//     panel shows one slider per servo up to JOINT_SLIDERS_MAX, else a joint
//     picker + one slider.
//
// Pure and client-safe (no three.js, no React). Same input → same output.

import type { LibraryPart, ProductSpec, StudioComponent } from "../schema";
import { servoNames, servoPlan } from "../servo-plan";

type GetPart = (id: string) => LibraryPart | undefined;

export const SIM_HZ = 20;
export const SIM_DT = 1 / SIM_HZ;

export const INPUT_KINDS = [
  "soil", "temperature", "humidity", "motion", "distance", "light",
  "button", "touch", "knob", "tilt", "time", "power", "joint",
] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

export const OUTPUT_KINDS = ["led", "ring", "pump", "motor", "servo", "buzzer", "speaker", "relay", "screen"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

export type ControlType = "slider" | "toggle" | "hold";
export type Unit = "%" | "°C" | "cm" | "°" | "h" | "s" | "";

export type Threshold = { value: number; min: number; max: number; step: number; unit: Unit };

export type SimControl = {
  /** `<instanceId>:<kind>` (or `spec:<kind>` when the input is the board itself, e.g. touch). */
  id: string;
  kind: InputKind;
  type: ControlType;
  /** Component instance the control stands for (its signal wire lights when it changes); null = no own part. */
  part: string | null;
  min: number;
  max: number;
  step: number;
  initial: number;
  unit: Unit;
  threshold?: Threshold;
  /** Joint controls (Part E): the servo instance it turns, its number (1-based) and its name. */
  servo?: string;
  n?: number;
  name?: { en: string; ar: string };
};

/** Up to this many joints get one slider each; more → a joint picker + one slider. */
export const JOINT_SLIDERS_MAX = 6;

export type SimOutput = {
  /** Component instance id. */
  id: string;
  kind: OutputKind;
  partId: string;
  /** LED lens colour (hex) when the part says it. */
  colour?: string;
  /** Pixels on a ring. */
  pixels?: number;
};

export type ButtonMode = "toggle" | "ring" | "pulse" | "hold";
export type RingColour = "blue" | "red" | "warm" | "cyan" | "green";
export const RING_HEX: Record<RingColour, string> = {
  blue: "#3b82f6",
  red: "#ef4444",
  warm: "#ffd9a0",
  cyan: "#22d3ee",
  green: "#22c55e",
};

/** How an output follows the primary input. */
export type OutMode =
  /** on while the input is active */
  | "follow"
  /** on while active, brightness / speed / pixels from the input level */
  | "level"
  /** servo: to the angle the input gives (knob, tilt) */
  | "angle"
  /** buzzer: beeps faster as the level rises (distance) */
  | "rate";

export type InputRule = {
  type: ControlType;
  min: number;
  max: number;
  step: number;
  initial: number;
  unit: Unit;
  threshold?: Omit<Threshold, "unit"> & { unit?: Unit };
  ring: RingColour;
  /** Per output kind; anything missing = "follow". */
  out: Partial<Record<OutputKind, OutMode>>;
};

/** The rule table: input kind × output kind, with sensible defaults. */
export const RULES: Record<InputKind, InputRule> = {
  // Value = how dry (0 wet … 100 dry). Dry above the threshold → water.
  soil: { type: "slider", min: 0, max: 100, step: 1, initial: 30, unit: "%", threshold: { value: 60, min: 10, max: 95, step: 5 }, ring: "blue", out: {} },
  temperature: { type: "slider", min: 0, max: 45, step: 1, initial: 24, unit: "°C", threshold: { value: 30, min: 15, max: 42, step: 1 }, ring: "red", out: {} },
  humidity: { type: "slider", min: 0, max: 100, step: 1, initial: 50, unit: "%", threshold: { value: 70, min: 30, max: 95, step: 5 }, ring: "blue", out: {} },
  // Motion: on for N seconds after it was last seen (the threshold is N).
  motion: { type: "toggle", min: 0, max: 1, step: 1, initial: 0, unit: "", threshold: { value: 5, min: 1, max: 60, step: 1, unit: "s" }, ring: "warm", out: {} },
  // Closer than the threshold → alert, the buzzer beeps faster the closer it gets.
  distance: { type: "slider", min: 2, max: 200, step: 1, initial: 120, unit: "cm", threshold: { value: 30, min: 5, max: 150, step: 5 }, ring: "red", out: { buzzer: "rate", speaker: "rate", ring: "level", led: "follow" } },
  // Light level (0 dark … 100 bright). Darker than the threshold → light up.
  light: { type: "slider", min: 0, max: 100, step: 1, initial: 70, unit: "%", threshold: { value: 30, min: 5, max: 90, step: 5 }, ring: "warm", out: {} },
  button: { type: "hold", min: 0, max: 1, step: 1, initial: 0, unit: "", ring: "warm", out: {} },
  touch: { type: "hold", min: 0, max: 1, step: 1, initial: 0, unit: "", ring: "warm", out: {} },
  knob: { type: "slider", min: 0, max: 100, step: 1, initial: 50, unit: "%", ring: "warm", out: { led: "level", ring: "level", pump: "level", motor: "level", servo: "angle" } },
  tilt: { type: "slider", min: -90, max: 90, step: 1, initial: 0, unit: "°", threshold: { value: 30, min: 5, max: 80, step: 5 }, ring: "green", out: { servo: "angle" } },
  // Hour of the day; night from the threshold until 6:00 → on.
  time: { type: "slider", min: 0, max: 23, step: 1, initial: 12, unit: "h", threshold: { value: 19, min: 15, max: 23, step: 1 }, ring: "warm", out: {} },
  power: { type: "toggle", min: 0, max: 1, step: 1, initial: 0, unit: "", ring: "warm", out: {} },
  // One per servo on a servo driver: the angle that servo turns to (it never drives anything else).
  joint: { type: "slider", min: 0, max: 180, step: 1, initial: 90, unit: "°", ring: "green", out: {} },
};

/** Which input drives the outputs when there are several (first found wins). */
const PRIORITY: InputKind[] = ["soil", "motion", "distance", "temperature", "light", "button", "touch", "knob", "tilt", "time", "humidity", "power", "joint"];

// ── Parts → kinds ───────────────────────────────────────────────────────────

/** Exact words: the part id + its tags (substrings would match "soil" on a temperature probe). */
const has = (p: LibraryPart, ...words: string[]) => {
  const set = new Set([p.id, ...(p.tags ?? [])].map((w) => w.toLowerCase()));
  return words.some((w) => set.has(w));
};
const builder = (p: LibraryPart) => (p.model.kind === "procedural" ? p.model.builder : "");

/** The input kinds a part gives (most give one; DHT22 gives temperature + humidity). */
export function inputKindsFor(p: LibraryPart): InputKind[] {
  if (p.category !== "sensor" && p.category !== "input") return [];
  if (has(p, "moisture", "soil_moisture_cap")) return ["soil"];
  if (has(p, "dht22", "dht11", "am2302")) return ["temperature", "humidity"];
  if (has(p, "temperature", "thermometer", "ds18b20")) return ["temperature"];
  if (has(p, "accelerometer", "imu", "tilt", "gyroscope", "mpu6050")) return ["tilt"];
  if (has(p, "pir", "presence", "radar")) return ["motion"];
  if (has(p, "ultrasonic", "distance", "sonar", "hcsr04")) return ["distance"];
  if (has(p, "ldr", "bh1750", "lux", "photoresistor", "light")) return ["light"];
  if (has(p, "rtc", "ds3231")) return ["time"];
  if (has(p, "encoder", "knob", "potentiometer")) return ["knob"];
  if (has(p, "touch")) return ["touch"];
  if (has(p, "button", "tactile", "push")) return ["button"];
  return [];
}

/** The output kind a part is, or null (drivers, sensors, boards …). */
export function outputKindFor(p: LibraryPart): OutputKind | null {
  const b = builder(p);
  if (p.category === "mcu" || p.category === "power" || p.category === "sensor" || p.category === "input") return null;
  // A servo driver board drives servos; it does not move itself.
  if (has(p, "servo_driver", "pca9685")) return null;
  if (b === "ledRing" || has(p, "ws2812", "neopixel")) return "ring";
  if (b === "led" || (p.category === "output" && has(p, "led"))) return "led";
  if (has(p, "relay", "relay_module")) return "relay";
  if (b === "waterPump" || has(p, "pump")) return "pump";
  if (b === "servo" || has(p, "servo")) return "servo";
  if (b === "n20Motor" || (p.category === "actuator" && has(p, "motor") && !has(p, "driver", "motor_driver"))) return "motor";
  if (b === "buzzer" || has(p, "buzzer")) return "buzzer";
  if (b === "speakerAmp" || has(p, "speaker")) return "speaker";
  if (b === "oledDisplay" || b === "lcdModule" || p.category === "display") return "screen";
  return null;
}

// ── The model ───────────────────────────────────────────────────────────────

export type SimModel = {
  controls: SimControl[];
  outputs: SimOutput[];
  /** The control that drives the outputs (null = nothing to drive them). */
  primary: string | null;
  buttonMode: ButtonMode;
  ring: RingColour;
  /** Board (mcu) instance ids — a wire's hop through a driver stops at them. */
  boards: string[];
};

export type SimDoc = {
  spec: Pick<ProductSpec, "inputs" | "outputs" | "features"> & Partial<Pick<ProductSpec, "actuators">>;
  components: Pick<StudioComponent, "instanceId" | "partId">[];
};

function control(id: string, kind: InputKind, part: string | null): SimControl {
  const r = RULES[kind];
  return {
    id,
    kind,
    type: r.type,
    part,
    min: r.min,
    max: r.max,
    step: r.step,
    initial: r.initial,
    unit: r.unit,
    ...(r.threshold ? { threshold: { ...r.threshold, unit: r.threshold.unit ?? r.unit } } : {}),
  };
}

export function simModel(doc: SimDoc, getPart: GetPart): SimModel {
  const controls: SimControl[] = [];
  const outputs: SimOutput[] = [];
  const boards: string[] = [];
  for (const c of doc.components) {
    const p = getPart(c.partId);
    if (!p) continue;
    if (p.category === "mcu") boards.push(c.instanceId);
    for (const k of inputKindsFor(p)) controls.push(control(`${c.instanceId}:${k}`, k, c.instanceId));
    const o = outputKindFor(p);
    if (o) {
      const params = p.model.kind === "procedural" ? p.model.params : {};
      const colour = typeof params.colour === "string" ? params.colour : typeof p.look.accent === "string" ? p.look.accent : undefined;
      const leds = typeof params.leds === "number" ? Math.round(params.leds) : undefined;
      outputs.push({
        id: c.instanceId,
        kind: o,
        partId: p.id,
        ...(o === "led" && colour ? { colour } : {}),
        ...(o === "ring" ? { pixels: leds && leds > 0 ? leds : 12 } : {}),
      });
    }
  }
  // The board itself can be the input (touch pins), or the spec names a button we have no part for.
  const kinds = new Set(controls.map((c) => c.kind));
  const specInputs = doc.spec.inputs ?? [];
  if (specInputs.includes("touch") && !kinds.has("touch") && !kinds.has("button")) controls.push(control("spec:touch", "touch", null));
  else if (specInputs.includes("button") && !kinds.has("button") && !kinds.has("touch")) controls.push(control("spec:button", "button", null));
  if (specInputs.includes("knob") && !kinds.has("knob")) controls.push(control("spec:knob", "knob", null));
  // Servos on a servo driver: one joint slider each (they follow their slider, nothing else).
  const plan = servoPlan(doc.components, doc.spec, getPart);
  const joints: SimControl[] = [];
  if (plan?.driver) {
    const en = servoNames(doc.components, doc.spec, getPart, "en");
    const ar = servoNames(doc.components, doc.spec, getPart, "ar");
    plan.servos.forEach((s, i) => {
      if (s.channel === null || !outputs.some((o) => o.id === s.instanceId)) return;
      const name = en.get(s.instanceId) && ar.get(s.instanceId) ? { en: en.get(s.instanceId)!, ar: ar.get(s.instanceId)! } : undefined;
      joints.push({ ...control(`${s.instanceId}:joint`, "joint", s.instanceId), servo: s.instanceId, n: i + 1, ...(name ? { name } : {}) });
    });
  }
  const jointServos = new Set(joints.map((j) => j.servo));
  // Outputs but nothing to drive them: one plain on/off switch.
  if (!controls.length && outputs.some((o) => !jointServos.has(o.id))) controls.push(control("spec:power", "power", null));

  controls.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const primary = controls[0] ?? null;
  controls.push(...joints);
  const outKinds = new Set(outputs.map((o) => o.kind));
  const buttonMode: ButtonMode = outKinds.has("servo")
    ? "pulse"
    : outKinds.has("buzzer") || outKinds.has("speaker")
      ? "ring"
      : outKinds.has("led") || outKinds.has("ring") || outKinds.has("relay") || outKinds.has("screen")
        ? "toggle"
        : "hold";
  const isButton = primary && (primary.kind === "button" || primary.kind === "touch");
  const ring: RingColour = isButton && buttonMode === "ring" ? "cyan" : primary ? RULES[primary.kind].ring : "warm";
  return { controls, outputs, primary: primary?.id ?? null, buttonMode, ring, boards };
}

/** How an output follows the primary input (the rule table, "follow" when not listed). */
export function outMode(input: InputKind | null, output: OutputKind): OutMode {
  return (input && RULES[input].out[output]) || "follow";
}
