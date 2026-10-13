// Part B: spec.actuators helpers shared by the idea card, the e2e mock and the picker.
//
// A spec may hold several groups of the same kind (an arm: servo ×3 heavy for
// base/shoulder/elbow + servo ×3 light for wrist/gripper). The card shows ONE line
// per kind with the total ("6 joints · servo motors"); the stepper changes that
// total, adding to / taking from the LAST group of the kind (the light end of an arm).

import { arabicCountForm } from "@/lib/text/count";
import { ACTUATOR_KINDS, LIMITS, type Actuator, type ActuatorKind, type ProductSpec } from "./schema";

export type ActuatorTotal = { kind: ActuatorKind; count: number };

/** One entry per kind present, in ACTUATOR_KINDS order, with the summed count (capped at 8). */
export function actuatorTotals(spec: Pick<ProductSpec, "actuators">): ActuatorTotal[] {
  const out: ActuatorTotal[] = [];
  for (const kind of ACTUATOR_KINDS) {
    const n = (spec.actuators ?? []).filter((a) => a.kind === kind).reduce((s, a) => s + a.count, 0);
    if (n > 0) out.push({ kind, count: Math.min(LIMITS.actuators.countMax, n) });
  }
  return out;
}

/**
 * The spec with the total of `kind` set to `count` (clamped 1..8). Grows / shrinks the
 * last group of that kind; a group that reaches 0 goes. No group of the kind yet → a new
 * medium one (only when there is room for another group). Same object when nothing changes.
 */
export function setActuatorCount<T extends Pick<ProductSpec, "actuators">>(spec: T, kind: ActuatorKind, count: number): T {
  const target = Math.min(LIMITS.actuators.countMax, Math.max(LIMITS.actuators.countMin, Math.round(count)));
  const groups: Actuator[] = (spec.actuators ?? []).map((a) => ({ ...a }));
  const mine = groups.filter((a) => a.kind === kind);
  const total = mine.reduce((s, a) => s + a.count, 0);
  if (total === target) return spec;
  if (!mine.length) {
    if (groups.length >= LIMITS.actuators.max) return spec;
    return { ...spec, actuators: [...groups, { kind, count: target, load: "medium" }] };
  }
  let diff = target - total;
  if (diff > 0) {
    mine[mine.length - 1].count += diff;
  } else {
    for (let i = mine.length - 1; i >= 0 && diff < 0; i--) {
      const take = Math.min(mine[i].count, -diff);
      mine[i].count -= take;
      diff += take;
    }
  }
  return { ...spec, actuators: groups.filter((a) => a.count > 0) };
}

/**
 * Part F: at most this many medium/heavy servos. The picker makes them MG996R (stall ~2.5 A)
 * and the power rule counts the largest stall + every other servo at 1/3 of its stall, so a
 * 4th MG996R already takes the 5 V 5 A supply over budget. The real model sometimes returns
 * "servo ×4 medium" for a plain robotic arm; the extra joints become light (wrist / gripper).
 */
export const STRONG_SERVO_MAX = 3;

/** The spec with medium/heavy servos capped at STRONG_SERVO_MAX (the rest moved to a light group). Same object when nothing changes. */
export function capStrongServos<T extends Pick<ProductSpec, "actuators">>(spec: T, max = STRONG_SERVO_MAX): T {
  const groups: Actuator[] = (spec.actuators ?? []).map((a) => ({ ...a }));
  const strong = groups.filter((a) => a.kind === "servo" && a.load !== "light");
  let excess = strong.reduce((s, a) => s + a.count, 0) - max;
  if (excess <= 0) return spec;
  const light = groups.filter((a) => a.kind === "servo" && a.load === "light").pop();
  if (!light && groups.length >= LIMITS.actuators.max) return spec; // no room for a light group
  const moved = excess;
  for (let i = strong.length - 1; i >= 0 && excess > 0; i--) {
    const take = Math.min(strong[i].count, excess);
    strong[i].count -= take;
    excess -= take;
  }
  if (light) light.count = Math.min(LIMITS.actuators.countMax, light.count + moved);
  const kept = groups.filter((a) => a.count > 0);
  return { ...spec, actuators: light ? kept : [...kept, { kind: "servo", count: moved, load: "light" }] };
}

// ── Counts typed in the chat ("make it 4 joints", "2 pumps", "٤ مفاصل") ─────────────

const KIND_WORDS: [ActuatorKind, RegExp][] = [
  ["stepper", /^(?:stepper|steppers|stepper motors?|محركات? خطوية?|محرك خطوي)/i],
  ["servo", /^(?:joints?|servos?|servo motors?|axis|axes|dof|مفاصل|مفصل|محركات سيرفو|سيرفو|محاور|محور)/i],
  ["pump", /^(?:pumps?|مضخات|مضخة|مضختين|مضختان)/i],
  ["motor", /^(?:motors?|wheels?|محركات|محرك|عجلات|عجلة)/i],
];

const toWestern = (s: string) => s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));

/** A count the user typed for a kind of actuator, or null. "6-axis" and "6 axis" both count. */
export function actuatorCountIn(text: string): ActuatorTotal | null {
  const t = toWestern(text);
  const re = /(\d{1,2})\s*(?:-|×|x)?\s*/g;
  for (let m = re.exec(t); m; m = re.exec(t)) {
    const rest = t.slice(m.index + m[0].length);
    for (const [kind, words] of KIND_WORDS) {
      if (words.test(rest)) {
        const n = Number(m[1]);
        if (n >= LIMITS.actuators.countMin && n <= LIMITS.actuators.countMax) return { kind, count: n };
      }
    }
  }
  return null;
}

// ── Plain words (outside next-intl: the mock and server labels) ─────────────

const NOUN: Record<ActuatorKind, { en: [string, string]; ar: { one: string; two: string; few: string; many: string } }> = {
  servo: { en: ["joint", "joints"], ar: { one: "مفصل واحد", two: "مفصلان", few: "مفاصل", many: "مفصلًا" } },
  motor: { en: ["motor", "motors"], ar: { one: "محرك واحد", two: "محركان", few: "محركات", many: "محركًا" } },
  pump: { en: ["pump", "pumps"], ar: { one: "مضخة واحدة", two: "مضختان", few: "مضخات", many: "مضخة" } },
  stepper: { en: ["stepper motor", "stepper motors"], ar: { one: "محرك خطوي واحد", two: "محركان خطويان", few: "محركات خطوية", many: "محركًا خطويًا" } },
};

/** "4 joints" / "4 مفاصل" (Western digits) — the short "what changed" label. */
export function actuatorCountLabel(kind: ActuatorKind, count: number, locale: "en" | "ar"): string {
  const n = NOUN[kind];
  if (locale === "en") return `${count} ${count === 1 ? n.en[0] : n.en[1]}`;
  const form = arabicCountForm(count);
  if (form === "one") return n.ar.one;
  if (form === "two") return n.ar.two;
  return `${count} ${form === "few" ? n.ar.few : n.ar.many}`;
}
