// Lid openings with the real library: every +z port gets its own hole, holes never
// touch each other (≥ 3 mm of lid between them) and each hole sits over its own part.
// Also the through-lid printed parts (button extender, light pipe) for the same combos.

import { describe, expect, it } from "vitest";
import { getPart } from "../library";
import { layoutComponents, worldBox } from "../layout";
import { defaultMechParts, layoutBounds, mechSummary } from "../ai/mech-default";
import { placeMechParts } from "../mech/place";
import type { EnclosureTemplate, LibraryPart, StudioComponent } from "../schema";
import { cutoutBox, type Cutout } from "./cutouts";
import { planEnclosure } from "./build";
import { topAt } from "./templates";
import { spec } from "./test-fixtures";

const TEMPLATES: EnclosureTemplate[] = ["rounded_box", "pill", "soft_wedge", "puck", "handheld_taper"];
/** Minimum lid material between two openings (mm). */
const MIN_WEB = 3;

const COMBOS: Record<string, string[]> = {
  // The e2e studio fixture (mock pick + the resistor the wiring adds).
  fixture: ["esp32_devkit", "pir_hcsr501", "oled_096_i2c", "led_5mm", "resistor_220"],
  "esp32+pir+oled+button+led": ["esp32_devkit", "pir_hcsr501", "oled_096_i2c", "button_6mm", "led_5mm", "resistor_220"],
  "uno+lcd+2 buttons+buzzer": ["arduino_uno", "lcd1602_i2c", "button_6mm", "button_6mm", "buzzer"],
  "pico w+ring+encoder": ["pico_w", "ws2812_ring", "rotary_encoder"],
};

function setup(ids: string[]) {
  const count = new Map<string, number>();
  const comps: StudioComponent[] = ids.map((partId) => {
    const n = (count.get(partId) ?? 0) + 1;
    count.set(partId, n);
    return { partId, instanceId: `${partId}_${n}`, label: partId, reason: "" } as StudioComponent;
  });
  const parts = new Map<string, LibraryPart>(comps.map((c) => [c.instanceId, getPart(c.partId)!]));
  const lr = layoutComponents(comps.map((c) => ({ instanceId: c.instanceId, part: parts.get(c.instanceId)! })), { clearance: 2 });
  return { comps, parts, lr };
}

/** XY rectangle of an opening (axis-aligned: every rotation is a multiple of 90°). */
function rectXY(c: Cutout) {
  const b = cutoutBox(c);
  return { x0: b.min[0], x1: b.max[0], y0: b.min[1], y1: b.max[1] };
}

/** Distance between two openings in XY (conservative: circles measured by their squares). */
function gap(a: Cutout, b: Cutout): number {
  const A = rectXY(a);
  const B = rectXY(b);
  const dx = Math.max(0, A.x0 - B.x1, B.x0 - A.x1);
  const dy = Math.max(0, A.y0 - B.y1, B.y0 - A.y1);
  if (dx === 0 && dy === 0) return -1;
  return Math.hypot(dx, dy);
}

describe("lid openings (real library)", () => {
  for (const [name, ids] of Object.entries(COMBOS)) {
    for (const template of TEMPLATES) {
      it(`${name} · ${template}`, () => {
        const { comps, parts, lr } = setup(ids);
        const { dims, placed, cutouts } = planEnclosure(spec({ template }), lr, parts);
        const top = cutouts.filter((c) => c.face === "+z");
        const zPorts = placed.reduce((n, it) => n + parts.get(it.instanceId)!.ports.filter((p) => p.face === "+z").length, 0);
        expect(top.length).toBe(zPorts);
        expect(zPorts).toBeGreaterThan(0);

        for (let i = 0; i < top.length; i++) {
          for (let j = i + 1; j < top.length; j++) {
            const g = gap(top[i], top[j]);
            expect(g, `${top[i].id} ↔ ${top[j].id}: ${g.toFixed(2)} mm`).toBeGreaterThanOrEqual(MIN_WEB - 1e-6);
          }
        }

        const [ox, oy] = dims.contentOffset;
        for (const c of top) {
          const item = placed.find((p) => p.instanceId === c.instanceId)!;
          const b = worldBox(item, parts.get(c.instanceId ?? "")!);
          // The opening's centre is over its own part …
          expect(c.center[0]).toBeGreaterThanOrEqual(b.min[0] + ox - 1e-6);
          expect(c.center[0]).toBeLessThanOrEqual(b.max[0] + ox + 1e-6);
          expect(c.center[1]).toBeGreaterThanOrEqual(b.min[1] + oy - 1e-6);
          expect(c.center[1]).toBeLessThanOrEqual(b.max[1] + oy + 1e-6);
          // … and over no other part's top-port opening area.
          for (const other of top) {
            if (other === c) continue;
            const r = rectXY(other);
            const inside = c.center[0] > r.x0 && c.center[0] < r.x1 && c.center[1] > r.y0 && c.center[1] < r.y1;
            expect(inside, `${c.id} inside ${other.id}`).toBe(false);
          }
        }

        // Through-lid printed parts: one per matching port, inside that port's own opening.
        const b = layoutBounds(comps, lr.layout, getPart)!;
        const mech = defaultMechParts(
          mechSummary({ components: comps, layout: lr.layout, getPart, enclosure: { w: b.w + 8, d: b.d + 8, h: b.h + 8 }, template }),
        );
        const through = mech.filter((m) => m.template === "button_extender" || m.template === "light_pipe");
        const want = top.filter((c) => c.kind === "button_cap" || c.kind === "led_light_pipe").length;
        expect(through.length).toBe(want);
        const places = placeMechParts(mech, { ...lr, layout: placed }, parts, dims);
        mech.forEach((m, i) => {
          if (m.template !== "button_extender" && m.template !== "light_pipe") return;
          const p = places[i].position;
          const own = top.find(
            (c) => c.instanceId === m.forInstance && c.kind === (m.template === "button_extender" ? "button_cap" : "led_light_pipe"),
          );
          expect(own, `${m.id} has an opening`).toBeTruthy();
          const r = rectXY(own!);
          expect(p[0]).toBeGreaterThan(r.x0);
          expect(p[0]).toBeLessThan(r.x1);
          expect(p[1]).toBeGreaterThan(r.y0);
          expect(p[1]).toBeLessThan(r.y1);
          // Height: extender cap ~1 mm proud of the lid, light pipe flush (0–0.3 mm).
          const tip = p[2] + (m.template === "button_extender" ? 1 + places[i].params.length + 2.5 : places[i].params.length);
          const proud = tip - topAt(dims, p[1]);
          if (m.template === "button_extender") {
            expect(proud).toBeGreaterThanOrEqual(0.5);
            expect(proud).toBeLessThanOrEqual(1.5);
          } else {
            expect(proud).toBeGreaterThanOrEqual(-1e-6);
            expect(proud).toBeLessThanOrEqual(0.3 + 1e-6);
          }
        });
      });
    }
  }
});
