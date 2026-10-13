import { describe, expect, it } from "vitest";

import { groupComponents, groupHas, quantities, withQuantity } from "./parts-group";
import type { StudioComponent } from "./schema";

const c = (partId: string, n: number, auto = false): StudioComponent => ({
  partId,
  instanceId: `${partId}_${n}`,
  label: partId,
  ...(auto ? { auto: true } : {}),
});

describe("groupComponents", () => {
  it("one row per part, first-seen order, quantity counted; auto parts never merge with chosen ones", () => {
    const list = [c("esp32_devkit", 1), c("mg996r_servo", 1), c("sg90_servo", 1), c("mg996r_servo", 2), c("mg996r_servo", 3), c("resistor_220", 1, true), c("resistor_220", 2, true), c("sg90_servo", 2)];
    const g = groupComponents(list);
    expect(g.map((x) => [x.key, x.partId, x.quantity, x.auto])).toEqual([
      ["esp32_devkit_1", "esp32_devkit", 1, false],
      ["mg996r_servo_1", "mg996r_servo", 3, false],
      ["sg90_servo_1", "sg90_servo", 2, false],
      ["resistor_220_1", "resistor_220", 2, true],
    ]);
    expect(groupHas(g[1], "mg996r_servo_3")).toBe(true);
    expect(groupHas(g[1], "sg90_servo_1")).toBe(false);
    expect(groupHas(g[1], null)).toBe(false);
    const mixed = groupComponents([c("led_5mm", 1), c("led_5mm", 2, true)]);
    expect(mixed.map((x) => x.quantity)).toEqual([1, 1]);
  });

  it("labels and counts", () => {
    expect(withQuantity("MG996R servo", 3)).toBe("MG996R servo × 3");
    expect(withQuantity("MG996R servo", 1)).toBe("MG996R servo");
    expect(Object.fromEntries(quantities([c("a", 1), c("a", 2), c("b", 1)]))).toEqual({ a: 2, b: 1 });
  });
});
