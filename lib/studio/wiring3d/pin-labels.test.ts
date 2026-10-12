// P5-17h: pin names on the 3D parts — one per pin, beside it, never on top of another.
import { describe, expect, it } from "vitest";

import { pinLabel } from "../connections";
import { getPart, LIBRARY } from "../library";
import { overlappingLabels, pinLabelLayout } from "./pin-labels";
import { pins3dFor } from "./pins3d";

const IDS = ["arduino_uno", "esp32_devkit", "esp32_c3_mini", "oled_096_i2c", "relay_module", "motor_driver"];

describe.each(IDS)("pin labels: %s", (id) => {
  const part = getPart(id)!;
  for (const rot of [0, 90, 180, 270] as const) {
    it(`one label per pin, beside its pin, no overlaps (rot ${rot})`, () => {
      const lay = pinLabelLayout(part, rot);
      const pins = pins3dFor(part);
      expect(lay.labels.map((l) => l.pin).sort()).toEqual(part.pins.filter((p) => pins[p.id]).map((p) => p.id).sort());
      for (const l of lay.labels) {
        const pin = part.pins.find((p) => p.id === l.pin)!;
        expect(l.text).toBe(pinLabel(part, pin));
        // Beside: the box starts within ~2 mm of the pin and does not cover the pin centre.
        const [x, y] = l.anchor;
        const dx = Math.max(l.box.x0 - x, 0, x - l.box.x1);
        const dy = Math.max(l.box.y0 - y, 0, y - l.box.y1);
        expect(Math.hypot(dx, dy), l.pin).toBeGreaterThan(0.5);
        expect(Math.hypot(dx, dy), l.pin).toBeLessThan(2.5);
        // Readable from the default camera: reads toward +x or +y on the mat.
        expect([0, 90]).toContain((l.angle + rot) % 360);
      }
      expect(overlappingLabels(lay)).toEqual([]);
    });
  }
});

it("ground pins read GND, supply pins their voltage", () => {
  const texts = pinLabelLayout(getPart("esp32_devkit")!).labels.map((l) => l.text);
  expect(texts).toContain("GND");
  expect(texts).toContain("3V3");
  expect(texts.some((t) => /^GPIO\d+$/.test(t))).toBe(true);
});

it("every library part gets labels without overlaps", () => {
  for (const part of LIBRARY) expect(overlappingLabels(pinLabelLayout(part)), part.id).toEqual([]);
});

it("a tall part on the board (chip, USB socket) sends the names to the other side of the row", () => {
  const part = getPart("esp32_c3_mini")!;
  const free = pinLabelLayout(part);
  const chip = { x0: -part.dims.x / 2 + 3.2, y0: -part.dims.y / 2, x1: part.dims.x / 2 - 3.2, y1: part.dims.y / 2 };
  const lay = pinLabelLayout(part, 0, [chip]);
  expect(lay.labels).toHaveLength(free.labels.length);
  const hits = (b: { x0: number; y0: number; x1: number; y1: number }) => b.x0 < chip.x1 && chip.x0 < b.x1 && b.y0 < chip.y1 && chip.y0 < b.y1;
  expect(lay.labels.filter((l) => hits(l.box))).toEqual([]);
  expect(overlappingLabels(lay)).toEqual([]);
});
