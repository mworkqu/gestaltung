// The PIR's dome pokes out through a ROUND lid opening (not a square hole with the dome hidden below).

import { describe, expect, it } from "vitest";
import { getPart } from "../library";
import { isPokeSensor, layoutComponents, POKE_OUT, worldBox } from "../layout";
import { buildEnclosure } from "./build";
import { cutoutBox } from "./cutouts";
import { settlePokes } from "./templates";
import { spec, items, P } from "./test-fixtures";
import type { EnclosureTemplate } from "../schema";

const TEMPLATES: EnclosureTemplate[] = ["rounded_box", "pill", "soft_wedge", "puck", "handheld_taper"];

function deskFriend() {
  return items(
    ["esp", getPart("esp32_devkit")!],
    ["pir", getPart("pir_hcsr501")!],
    ["oled", getPart("oled_096_i2c")!],
    ["led", getPart("led_5mm")!],
    ["res", getPart("resistor_220")!],
  );
}

describe("poke-through sensor (PIR)", () => {
  it("recognises the PIR (and not the OLED, a side-window sensor or a big square window)", () => {
    expect(isPokeSensor(getPart("pir_hcsr501")!)).toBe(true);
    expect(isPokeSensor(getPart("oled_096_i2c")!)).toBe(false);
    expect(isPokeSensor(getPart("dht22")!)).toBe(false); // sensor_window on +x, not +z
    expect(isPokeSensor(P.sensor)).toBe(false);
  });

  it("the PIR does not set the height of the stack the other +z parts are raised to", () => {
    const list = deskFriend();
    const lr = layoutComponents(list, { clearance: 2 });
    const parts = new Map(list.map((i) => [i.instanceId, i.part]));
    const oled = worldBox(lr.layout.find((l) => l.instanceId === "oled")!, parts.get("oled")!);
    expect(lr.pokeHeight).toBe(getPart("pir_hcsr501")!.dims.z);
    expect(lr.bodyHeight).toBeCloseTo(oled.max[2], 6); // the OLED is level with the body, not with the dome
    expect(lr.height).toBeGreaterThanOrEqual(lr.bodyHeight!);
  });

  for (const template of TEMPLATES) {
    it(`dome top sits above the lid's inner top, through a round opening: ${template}`, () => {
      const list = deskFriend();
      const parts = new Map(list.map((i) => [i.instanceId, i.part]));
      const lr = layoutComponents(list, { clearance: 2 });
      const { meta } = buildEnclosure(spec({ template }), lr, parts);
      const d = meta.dims;
      const pir = meta.layout.find((l) => l.instanceId === "pir")!;
      const dome = parts.get("pir")!;
      const apex = d.floorZ + pir.pos[2] + dome.dims.z; // enclosure space
      const y = pir.pos[1] + d.contentOffset[1];
      const outerTop = d.wedgeDeg ? d.H + (Math.min(y, d.D / 2) - d.D / 2) * Math.tan((d.wedgeDeg * Math.PI) / 180) : d.H;
      const innerTop = outerTop - d.wall;
      expect(apex).toBeGreaterThan(innerTop); // above the lid's inner top surface
      expect(apex - outerTop).toBeGreaterThanOrEqual(POKE_OUT - 0.01); // and out through the top
      expect(apex - outerTop).toBeLessThanOrEqual(4);
      expect(pir.pos[2]).toBeGreaterThanOrEqual(0);

      // The opening is round and at least dome diameter + tolerance wide.
      const cut = meta.cutouts.find((c) => c.instanceId === "pir")!;
      expect(cut.shape).toBe("circle");
      expect(cut.w).toBe(cut.h);
      const domeDia = 2 * Math.min(11.5, dome.dims.y / 2 - 0.4);
      expect(cut.w).toBeGreaterThanOrEqual(domeDia + 0.5);
      // It cuts the whole lid plate (below its inner surface up past its outer one).
      const box = cutoutBox(cut);
      expect(box.min[2]).toBeLessThanOrEqual(innerTop);
      expect(box.max[2]).toBeGreaterThanOrEqual(outerTop);
    });
  }

  it("the OLED stays flush right under its window (not lifted with the PIR)", () => {
    const list = deskFriend();
    const parts = new Map(list.map((i) => [i.instanceId, i.part]));
    const lr = layoutComponents(list, { clearance: 2 });
    const { meta } = buildEnclosure(spec({ template: "rounded_box" }), lr, parts);
    const d = meta.dims;
    const oled = meta.layout.find((l) => l.instanceId === "oled")!;
    const top = d.floorZ + oled.pos[2] + parts.get("oled")!.dims.z;
    expect(top).toBeLessThan(d.H - d.wall); // inside the case, close under the lid
    expect(d.H - d.wall - top).toBeLessThan(6);
  });

  it("settlePokes only moves poke sensors", () => {
    const list = deskFriend();
    const parts = new Map(list.map((i) => [i.instanceId, i.part]));
    const lr = layoutComponents(list, { clearance: 2 });
    const { meta } = buildEnclosure(spec(), lr, parts);
    const out = settlePokes(lr.layout, parts, meta.dims);
    for (const it of out) {
      const before = lr.layout.find((l) => l.instanceId === it.instanceId)!;
      if (it.instanceId === "pir") expect(it.pos[2]).toBeGreaterThanOrEqual(before.pos[2]);
      else expect(it).toEqual(before);
    }
  });
});
