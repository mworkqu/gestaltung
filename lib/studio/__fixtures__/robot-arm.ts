// Part E fixture: the 6-axis desktop robot arm ("big robotic arm like ur10") as it leaves
// the Idea and Parts steps. The parts are what the Part D rules make of the model's pick
// (esp32_devkit + one sg90): 3 × MG996R (base, shoulder, elbow) + 3 × SG90 (wrist pitch,
// wrist roll, gripper) on a PCA9685 servo driver, fed by the 5 V 5 A wall supply.
// robot-arm.test.ts checks that enforcePick still gives exactly this list.
// Part F: the Studio e2e mock answers "big robotic arm like ur10" with robotArmSpec(locale)
// (scale note + "6 joints"), so the chat-driven test lands on the same parts and wiring.

import { clampSpec, type ProductSpec, type StudioComponent } from "../schema";

const ARM_TEXT = {
  en: {
    name: "Robotic Arm",
    oneLine: "A desktop arm that moves like a UR10, about 35 cm, with hobby servos.",
    scaleNote: "A real UR10 is an industrial arm (1.3 m reach, 10 kg). This is a 30–40 cm desktop version.",
    strong: "base, shoulder, elbow",
    light: "wrist pitch, wrist roll, gripper",
  },
  ar: {
    name: "ذراع روبوت",
    oneLine: "ذراع مكتبية تتحرك مثل UR10، بطول 35 سم تقريباً، بمحركات سيرفو صغيرة.",
    scaleNote: "ذراع UR10 الحقيقية صناعية (مدى 1.3 م، 10 كغ). هذه نسخة مكتبية بطول 30–40 سم.",
    strong: "القاعدة، الكتف، المرفق",
    light: "ميل المعصم، دوران المعصم، القابض",
  },
} as const;

/** The desktop arm's card in the page language (the e2e mock's answer to "big robotic arm like ur10"). */
export function robotArmSpec(locale: "en" | "ar" = "en"): ProductSpec {
  const t = ARM_TEXT[locale];
  return clampSpec({
    name: t.name,
    oneLine: t.oneLine,
    scaleNote: t.scaleNote,
    use: "desk",
    power: "mains_adapter",
    environment: "indoor",
    features: ["6 joints", "gripper", "moves objects"],
    inputs: [],
    outputs: ["motor"],
    sizeHint: "desk",
    style: "minimal",
    quantity: 1,
    actuators: [
      { kind: "servo", count: 3, load: "heavy", role: t.strong },
      { kind: "servo", count: 3, load: "light", role: t.light },
    ],
  });
}

/** The reply that comes with that first card (scope honesty, Part A). */
export const ROBOT_ARM_REPLY = {
  en: "A real UR10 is an industrial arm (1.3 m reach, 10 kg). We can build a desktop version that moves like it, about 30–40 cm, with hobby servos.",
  ar: "ذراع UR10 الحقيقية صناعية (مدى 1.3 م، 10 كغ). يمكننا بناء نسخة مكتبية تتحرك مثلها بطول 30–40 سم بمحركات سيرفو صغيرة.",
} as const;

/** The pick the real model made in the incident (one board, one SG90); the Part D rules make the arm of it. */
export const ROBOT_ARM_MODEL_PICK = ["esp32_devkit", "sg90_servo"] as const;

export const ROBOT_ARM_SPEC: ProductSpec = clampSpec({
  name: "Robotic Arm",
  oneLine: "A desktop arm that moves like a UR10, about 35 cm, with hobby servos.",
  use: "desk",
  power: "mains_adapter",
  environment: "indoor",
  features: ["6 joints", "gripper", "moves objects"],
  inputs: [],
  outputs: ["motor"],
  sizeHint: "desk",
  style: "minimal",
  quantity: 1,
  actuators: [
    { kind: "servo", count: 3, load: "heavy", role: "base, shoulder, elbow" },
    { kind: "servo", count: 3, load: "light", role: "wrist pitch, wrist roll, gripper" },
  ],
});

/** Library part ids in pick order (an id several times = several instances). */
export const ROBOT_ARM_PART_IDS = [
  "esp32_devkit",
  "psu_5v_5a",
  "pca9685_servo",
  "mg996r_servo",
  "mg996r_servo",
  "mg996r_servo",
  "sg90_servo",
  "sg90_servo",
  "sg90_servo",
];

/** Components with the picker's instance ids (mg996r_servo_1…3, sg90_servo_1…3). */
export function robotArmComponents(ids: readonly string[] = ROBOT_ARM_PART_IDS): StudioComponent[] {
  const n = new Map<string, number>();
  return ids.map((partId) => {
    const k = (n.get(partId) ?? 0) + 1;
    n.set(partId, k);
    return { partId, instanceId: `${partId}_${k}`, label: partId };
  });
}
