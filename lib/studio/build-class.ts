// Build class — WHAT KIND of build this is (owner, 2026-10-20). Pure.
//
// The second axis next to the tier in lib/studio/tiers.ts. Keep them apart:
//
//   tier  = how BIG the build is (sensors / movers / controllers) → the price.
//   class = what SHAPE the build is                               → the pipeline.
//
// A De Morgan logic kit is TINY (it prices as an Explorer build, correctly) but
// has no firmware and no microcontroller at all. Before this file the picker
// forced an MCU on every build — "Exactly one mcu" in ai/pick.ts — so a card
// that said "no microcontroller, pure TTL gates" still came back with an ESP32.
// Charging such a build a higher tier would have been the wrong fix: it is the
// cheapest thing we make, it was simply the wrong SHAPE.
//
// Three deliverable steps exist: wiring, print, code. The class says which one
// leads and which fade out. Faded is not deleted — the step stays reachable,
// greyed, with one line saying why, because the user may always overrule us.

import type { StepId } from "./palette";
import type { BuildClass, ProductSpec } from "./schema";

export type { BuildClass };

/** The three steps that are a deliverable in their own right. */
export const DELIVERABLE_STEPS = ["wiring", "print", "code"] as const satisfies readonly StepId[];
export type DeliverableStep = (typeof DELIVERABLE_STEPS)[number];

type ClassPlan = {
  /** The deliverable this class is really about. */
  lead: DeliverableStep;
  /** Deliverables that fade out (shown greyed with a reason, still reachable). */
  faded: readonly DeliverableStep[];
  /** Does this class run firmware, and therefore need a microcontroller? */
  controller: boolean;
  /** i18n key under Studio for the one line explaining why a step is faded. */
  reasonKey: string;
};

export const CLASS_PLAN: Record<BuildClass, ClassPlan> = {
  mcu: { lead: "code", faded: [], controller: true, reasonKey: "" },
  logic: { lead: "wiring", faded: ["print", "code"], controller: false, reasonKey: "fadedLogic" },
  cad: { lead: "print", faded: ["wiring", "code"], controller: false, reasonKey: "fadedCad" },
};

/** The class stored on the card, or "mcu" for cards made before build classes existed. */
export function buildClassOf(spec: Pick<ProductSpec, "buildClass"> | null | undefined): BuildClass {
  return spec?.buildClass ?? "mcu";
}

/** Does this build run firmware on a board of its own? */
export function needsController(spec: Pick<ProductSpec, "buildClass"> | null | undefined): boolean {
  return CLASS_PLAN[buildClassOf(spec)].controller;
}

/** Is this step faded for this build (greyed, with a reason, but still reachable)? */
export function isFaded(spec: Pick<ProductSpec, "buildClass"> | null | undefined, step: StepId): boolean {
  return (CLASS_PLAN[buildClassOf(spec)].faded as readonly string[]).includes(step);
}

/** The i18n key for why `step` is faded, or null when it is not faded. */
export function fadedReasonKey(spec: Pick<ProductSpec, "buildClass"> | null | undefined, step: StepId): string | null {
  const plan = CLASS_PLAN[buildClassOf(spec)];
  return (plan.faded as readonly string[]).includes(step) ? plan.reasonKey : null;
}

/**
 * The enclosure step belongs to the print deliverable: a class that fades print
 * fades the case with it (a breadboard kit wants a base plate at most, not a
 * sealed box).
 */
export function isFadedStep(spec: Pick<ProductSpec, "buildClass"> | null | undefined, step: StepId): boolean {
  return isFaded(spec, step === "enclosure" ? "print" : step);
}

// ── Inference ──────────────────────────────────────────────────────────────
//
// The agent sets spec.buildClass itself. These regexes are the safety net for
// when it does not (an older model, a card from before this field, a cached
// answer): they read the words the user actually wrote. Deliberately narrow —
// guessing "logic" wrongly would strip the MCU off a build that needs one, so
// anything unclear stays "mcu".

/** Said plainly: no microcontroller / no code. */
const NO_MCU_RE =
  /\b(no|without|don'?t need|do not need|dont need)\b[^.!?]{0,40}\b(micro-?controller|mcu|arduino|esp32|raspberry|board|firmware|code|programming|software)\b|بدون[^.!?]{0,30}(متحكم|أردوينو|برمجة|كود)/i;
/**
 * Discrete logic: 7400-series gates (bare, or the real 74LS/74HC/74HCT/CD4000
 * part numbers), named gates, truth tables, De Morgan. The part number alone
 * counts — a user may write "I need a 7408 and a 7432" without the word "gate".
 */
const LOGIC_RE =
  /\b(74(?:ls|hct?|f|s)?[0-9]{2,3}|cd4[0-9]{3}|logic gates?|gate ics?|and gate|or gate|not gate|nand|nor gate|xor|truth table|de ?morgan|boolean (?:algebra|expression|logic)|combinational|flip-?flop)\b|(بوابات? منطقية|جدول الحقيقة|دي ?مورغان)/i;
/** The deliverable is a printed / modelled part, not a circuit. */
const CAD_RE =
  /\b(3d ?print|printed part|stl|cad model|enclosure only|case only|bracket|mount|holder|jig|fixture|figurine|keychain|model only|no electronics|no circuit)\b|(طباعة ثلاثية|مجسم|حامل|قالب)/i;

/** Every word on the card that could name the build's shape. */
function textOf(spec: ProductSpec): string {
  const u = spec.understanding;
  return [
    spec.name,
    spec.oneLine,
    ...spec.features,
    u?.goal ?? "",
    u?.howItWorks ?? "",
    u?.controller ?? "",
    ...(u?.outputs ?? []).map((o) => `${o.name} ${o.purpose ?? ""}`),
    ...(u?.sensors ?? []).map((s) => `${s.name} ${s.purpose ?? ""}`),
  ].join(" . ");
}

/** A switch or a button is the only input a gate kit has; anything else is a real sensor. */
const SWITCH_INPUT_RE = /switch|toggle|button|push|dip\b|مفتاح|زر/i;

/** Sensors on the card that a gate kit could not have (soil, distance, IMU, light…). */
function realSensorCount(spec: ProductSpec): number {
  return (spec.understanding?.sensors ?? []).filter((s) => !SWITCH_INPUT_RE.test(`${s.name} ${s.purpose ?? ""}`)).length;
}

/** A screen needs something to drive it, so a gate kit never has one. */
function hasScreen(spec: ProductSpec): boolean {
  if (spec.outputs.includes("screen")) return true;
  return (spec.understanding?.outputs ?? []).some((o) => /screen|display|oled|lcd|شاشة/i.test(o.name));
}

/**
 * The class the card's own words imply, or null when nothing says. Never
 * overrides a class the agent (or the user) already set — see classFor().
 */
export function inferBuildClass(spec: ProductSpec): BuildClass | null {
  const text = textOf(spec);
  // A build that moves something needs a brain to drive it: never a logic kit
  // and never a print-only job, whatever the words say.
  const movers = (spec.actuators?.length ?? 0) > 0 || (spec.understanding?.actuators.length ?? 0) > 0;
  if (movers) return null;

  // "logic" keeps the wiring step, so it is the gentler of the two guesses —
  // but in the picker it is the EXPENSIVE one, because it strips the board off
  // the build. A word like "flip-flop" or "truth table" can turn up in the
  // description of an ordinary sensing product, and that product must keep its
  // microcontroller. A real gate kit is shaped a particular way: its only
  // inputs are switches, and it has no screen (nothing drives a display
  // without a board). Anything richer than that is not a gate kit, whatever it
  // says.
  if (LOGIC_RE.test(text) && !hasScreen(spec) && realSensorCount(spec) === 0) return "logic";

  // "cad" strips BOTH wiring and code, so it is the most damaging guess to get
  // wrong, and two separate roads lead here ("no microcontroller" and "3d
  // printed bracket"). A card that drives anything at all — a sensor, an LED, a
  // buzzer, a button — is electronics whatever it is called: "Phone holder with
  // status LED" matches /holder/ but is emphatically not a print-only job. So
  // the build must be electrically empty, not merely sensor-free.
  const electrical =
    (spec.understanding?.sensors.length ?? 0) > 0 ||
    (spec.understanding?.outputs.length ?? 0) > 0 ||
    spec.outputs.length > 0 ||
    spec.inputs.length > 0;
  if (electrical) return null;

  if (NO_MCU_RE.test(text) || CAD_RE.test(text)) return "cad";
  return null;
}

/** The class to use: what the card stores, else what its words imply, else "mcu". */
export function classFor(spec: ProductSpec | null | undefined): BuildClass {
  if (!spec) return "mcu";
  return spec.buildClass ?? inferBuildClass(spec) ?? "mcu";
}
