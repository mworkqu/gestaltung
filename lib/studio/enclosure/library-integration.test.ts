// Layout + enclosure with the real component library (all parts, every Phase 1 template).

import { describe, expect, it } from "vitest";
import { LIBRARY } from "../library";
import { isPokeSensor, layoutComponents, worldBox } from "../layout";
import type { EnclosureTemplate } from "../schema";
import { buildEnclosure } from "./build";
import { insideSection, topAt } from "./templates";
import { spec } from "./test-fixtures";

const TEMPLATES: EnclosureTemplate[] = ["rounded_box", "pill", "soft_wedge", "puck", "handheld_taper"];

describe("real library", () => {
  const list = LIBRARY.map((part, i) => ({ instanceId: `${part.id}_${i}`, part }));
  const parts = new Map(list.map((i) => [i.instanceId, i.part]));

  for (const template of TEMPLATES) {
    it(`builds an enclosure around every library part: ${template}`, () => {
      const lr = layoutComponents(list, { clearance: 2 });
      const t0 = performance.now();
      const { base, lid, meta } = buildEnclosure(spec({ template, feet: "rubber_4" }), lr, parts);
      const ms = performance.now() - t0;
      console.info(`[enclosure] library/${template}: ${meta.W}×${meta.D}×${meta.H} mm, ${ms.toFixed(0)} ms, ${meta.triangles} tris, ${meta.cutouts.length} cutouts`);
      expect(base.geometry.getAttribute("position").count).toBeGreaterThan(0);
      expect(lid.geometry.getAttribute("position").count).toBeGreaterThan(0);
      expect(meta.triangles).toBeLessThan(60000);
      const placed = new Set(lr.layout.map((i) => i.instanceId));
      expect(meta.cutouts.length).toBe(list.filter((i) => placed.has(i.instanceId)).reduce((n, i) => n + i.part.ports.length, 0));
      const d = meta.dims;
      for (const it of lr.layout) {
        // Poke-through domes (the PIR) leave the cavity through the lid on purpose.
        if (isPokeSensor(parts.get(it.instanceId)!)) continue;
        const b = worldBox(it, parts.get(it.instanceId)!);
        for (const x of [b.min[0] - d.clearance, b.max[0] + d.clearance]) {
          for (const y of [b.min[1] - d.clearance, b.max[1] + d.clearance]) {
            expect(insideSection(d, x, y, d.wall)).toBe(true);
            expect(b.max[2] + d.floorZ + d.clearance).toBeLessThanOrEqual(topAt(d, y) - d.wall + 1e-6);
          }
        }
      }
      // CSG of the whole library: ~1 s alone, slower when the full suite runs in parallel.
    }, 30_000);
  }
});
