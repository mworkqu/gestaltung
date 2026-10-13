// Part D → Part E hand-over: how the picked servos are meant to be wired and powered.
// Pure, derived from the parts list + spec (nothing extra is stored in the doc):
//
//  * servos in list order (the picker puts the strong MG996R first, then SG90), each with
//    its driver channel 0..n-1 and a role from spec.actuators ("base", "gripper"…);
//  * driver = the PCA9685 instance when picked: servo SIG → CH<n>_PWM, VCC → CH<n>_V,
//    GND → CH<n>_GND; the PCA9685 talks I2C (SDA/SCL + VCC logic) to the board;
//  * power: "supply" = servos are fed from the wall supply's 5 V through the PCA9685
//    V+ terminal (V_PLUS / V_GND), NEVER from the board's 5V pin; the board takes its
//    power from the same supply. "board" = a small servo (or two) on the board's 5V.

import { BIG_SUPPLY, SERVO_DRIVER, SERVO_IDS, SUPPLY_BOARD_IDS } from "./ai/actuator-rules";
import type { LibraryPart, ProductSpec, StudioComponent } from "./schema";

export type ServoPlanEntry = {
  instanceId: string;
  partId: string;
  /** Driver channel (0-based) when a driver is picked, else null (a board PWM pin). */
  channel: number | null;
  /** From spec.actuators[].role ("base", "gripper"…), when given. */
  role?: string;
};

export type ServoPlan = {
  servos: ServoPlanEntry[];
  /** PCA9685 instance id, or null. */
  driver: string | null;
  /** The supply board feeding the servos (psu_5v_5a, usbc_power_5v), or null. */
  supply: string | null;
  /** "supply" = supply 5 V → PCA9685 V+ (or straight to the servos' V+); "board" = the board's 5V pin. */
  poweredFrom: "supply" | "board";
  /** Sum of the servos' stall currents (mA). */
  stallMA: number;
  /** What the supply can give (mA), or null when unknown / no supply. */
  supplyMA: number | null;
};

/** Per-servo roles from the spec's servo groups ("base, shoulder, elbow" ×3 → one each). */
function servoRoles(spec: Pick<ProductSpec, "actuators">): (string | undefined)[] {
  const groups = (spec.actuators ?? []).filter((a) => a.kind === "servo");
  // Same order as the picker: strong (heavy/medium) groups first, then light ones.
  const ordered = [...groups.filter((g) => g.load !== "light"), ...groups.filter((g) => g.load === "light")];
  return ordered.flatMap((g) => {
    const parts = (g.role ?? "").split(/\s*[,،]\s*|\s+and\s+/).map((s) => s.trim()).filter(Boolean);
    return Array.from({ length: g.count }, (_, i) => (parts.length === g.count ? parts[i] : g.role || undefined));
  });
}

export function servoPlan(
  components: readonly Pick<StudioComponent, "instanceId" | "partId">[],
  spec: Pick<ProductSpec, "actuators">,
  getPart: (id: string) => LibraryPart | undefined,
): ServoPlan | null {
  const servos = components.filter((c) => SERVO_IDS.has(c.partId));
  if (!servos.length) return null;
  const driver = components.find((c) => c.partId === SERVO_DRIVER)?.instanceId ?? null;
  const supplyC =
    components.find((c) => c.partId === BIG_SUPPLY) ?? components.find((c) => SUPPLY_BOARD_IDS.has(c.partId)) ?? null;
  const roles = servoRoles(spec);
  const stallMA = servos.reduce((s, c) => s + (getPart(c.partId)?.power.mA ?? 0), 0);
  return {
    servos: servos.map((c, i) => ({
      instanceId: c.instanceId,
      partId: c.partId,
      channel: driver ? i : null,
      ...(roles[i] ? { role: roles[i] } : {}),
    })),
    driver,
    supply: supplyC?.instanceId ?? null,
    poweredFrom: supplyC && (driver || supplyC.partId === BIG_SUPPLY) ? "supply" : "board",
    stallMA,
    supplyMA: supplyC ? getPart(supplyC.partId)?.power.supplyMA ?? null : null,
  };
}

// ── Power: the realistic worst case (Part E) ────────────────────────────────
//
// RULE (orchestrator decision, Part E): servos sharing one supply never all stall at
// the same moment, so the realistic worst case is the single LARGEST servo stall current
// in full plus every OTHER servo at one third of its stall current. Over what the supply
// gives (supplyMA) → the existing blocking power line in the plain checks.
// Example: the 6-axis arm (3 × MG996R 2500 mA + 3 × SG90 250 mA) on the 5 V 5 A supply:
// 2500 + 2 × 833 + 3 × 83 ≈ 4417 mA < 5000 mA → passes.

/** Largest stall in full + one third of every other stall (mA). */
export function servoWorstCaseMA(stallsMA: readonly number[]): number {
  if (!stallsMA.length) return 0;
  const sorted = [...stallsMA].sort((a, b) => b - a);
  return sorted[0] + sorted.slice(1).reduce((s, x) => s + x / 3, 0);
}

/** The servo current a plan draws in the realistic worst case (mA). */
export function servoPlanMA(plan: ServoPlan, getPart: (id: string) => LibraryPart | undefined): number {
  return servoWorstCaseMA(plan.servos.map((s) => getPart(s.partId)?.power.mA ?? 0));
}

// ── Names: "Servo 1 — base" ─────────────────────────────────────────────────

const SERVO_WORD = { en: "Servo", ar: "سيرفو" } as const;

/**
 * Per-instance display names when a product has two or more servos (identical parts
 * would otherwise share one name in every view): "Servo 1 — base", "Servo 2"… in
 * servo-plan order (= driver channel order). Western digits in both locales. One servo
 * keeps the part's own name.
 */
export function servoNames(
  components: readonly Pick<StudioComponent, "instanceId" | "partId">[],
  spec: Pick<ProductSpec, "actuators">,
  getPart: (id: string) => LibraryPart | undefined,
  locale: "en" | "ar",
): Map<string, string> {
  const plan = servoPlan(components, spec, getPart);
  const out = new Map<string, string>();
  if (!plan || plan.servos.length < 2) return out;
  // A role shared by several servos ("arm joints" ×6) names none of them.
  const seen = new Map<string, number>();
  for (const s of plan.servos) if (s.role) seen.set(s.role.toLowerCase(), (seen.get(s.role.toLowerCase()) ?? 0) + 1);
  plan.servos.forEach((s, i) => {
    const base = `${SERVO_WORD[locale]} ${i + 1}`;
    const role = s.role && seen.get(s.role.toLowerCase()) === 1 ? s.role.trim().slice(0, 24).trim() : "";
    out.set(s.instanceId, role ? `${base} — ${role}` : base);
  });
  return out;
}
