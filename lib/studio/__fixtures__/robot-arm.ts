// Part E fixture: the 6-axis desktop robot arm ("big robotic arm like ur10") as it leaves
// the Idea and Parts steps. The parts are what the Part D rules make of the model's pick
// (esp32_devkit + one sg90): 3 × MG996R (base, shoulder, elbow) + 3 × SG90 (wrist pitch,
// wrist roll, gripper) on a PCA9685 servo driver, fed by the 5 V 5 A wall supply.
// robot-arm.test.ts checks that enforcePick still gives exactly this list.

import { clampSpec, type ProductSpec, type StudioComponent } from "../schema";

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
