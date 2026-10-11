import { describe, expect, it } from "vitest";
import { esc } from "@/lib/prototyping/netlist";
import { buildConnections, pinLabel, WIRE_HEX, WIRE_OUTLINE } from "./connections";
import { getPart, LIBRARY } from "./library";
import { buildWiring } from "./netlist";
import { DEFAULT_SPEC, type StudioComponent } from "./schema";
import { renderWiringSVG } from "./wiring-drawing";

const comps = (ids: string[]): StudioComponent[] => ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));
const PLANT = ["esp32_devkit", "soil_moisture_cap", "pump_5v", "motor_driver", "led_5mm", "usbc_power_5v"];
const reEsc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

function build(ids: string[], locale: "en" | "ar" = "en") {
  const w = buildWiring(comps(ids), DEFAULT_SPEC, getPart, locale);
  const connections = buildConnections(w.components, w.netlist.nets, getPart);
  const svg = renderWiringSVG(w.components, w.netlist.nets, getPart, { locale, connections });
  return { w, connections, svg };
}

describe("renderWiringSVG", () => {
  const { w, connections, svg } = build(PLANT);

  it("has connections and a well-formed root", () => {
    expect(connections.length).toBeGreaterThan(5);
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg.endsWith("</svg>")).toBe(true);
    expect(svg).toContain('direction="ltr"');
  });

  it("draws every connection with data-conn and its wire colour", () => {
    const mains = [...svg.matchAll(/<path class="wire-main" data-conn="([^"]+)" data-colour="([^"]+)"[^>]*? stroke="([^"]+)"/g)];
    for (const c of connections) {
      const mine = mains.filter((m) => m[1] === c.id);
      expect(mine.length, c.id).toBeGreaterThanOrEqual(1);
      for (const m of mine) {
        expect(m[2]).toBe(c.wireColour);
        expect(m[3]).toBe(WIRE_HEX[c.wireColour]);
      }
      if (WIRE_OUTLINE[c.wireColour]) expect(svg).toContain(`class="wire-casing" data-conn="${c.id}"`);
    }
  });

  it("uses cubic Bezier curves for wires", () => {
    const d = [...svg.matchAll(/class="wire-main"[^>]* d="([^"]+)"/g)].map((m) => m[1]);
    expect(d.length).toBeGreaterThan(0);
    for (const x of d) expect(x).toMatch(/^M[\d. -]+C/);
  });

  it("labels every pin a connection uses, with the pin label", () => {
    const parts = new Map(w.components.map((c) => [c.instanceId, getPart(c.partId)!]));
    let n = 0;
    for (const c of connections) {
      for (const e of [c.from, c.to]) {
        const ref = `${e.part}.${e.pin}`;
        expect(svg, ref).toContain(`data-pin="${esc(ref)}"`);
        const p = parts.get(e.part)!;
        const label = pinLabel(p, p.pins.find((x) => x.id === e.pin)!);
        expect(svg).toMatch(new RegExp(`data-pin-label="${reEsc(esc(ref))}"[^>]*>${reEsc(esc(label))}</text>`));
        n++;
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it("labels every pin of every part, not only the used ones", () => {
    for (const c of w.components) {
      for (const p of getPart(c.partId)!.pins) expect(svg).toContain(`data-pin="${esc(`${c.instanceId}.${p.id}`)}"`);
    }
  });

  it("carries both segments of a via wire with the same id, on a breadboard strip", () => {
    const { svg: s, connections: cs } = build(["esp32_devkit", "led_5mm"]);
    const via = cs.find((c) => c.viaPart);
    expect(via).toBeTruthy();
    expect([...s.matchAll(new RegExp(`class="wire-main" data-conn="${via!.id}"`, "g"))]).toHaveLength(2);
    expect(s).toContain("data-breadboard=");
  });

  it("uses a rail when one pin feeds three parts", () => {
    const { svg: s } = build(["esp32_devkit", "soil_moisture_cap", "pir_hcsr501", "dht22", "oled_096_i2c"]);
    expect(s).toContain("data-rail=");
    expect(s).toContain("data-conns=");
  });

  it("escapes text and is deterministic", () => {
    const again = renderWiringSVG(w.components, w.netlist.nets, getPart, { locale: "en", connections });
    expect(again).toBe(svg);
    const evil = w.components.map((c, i) => (i === 0 ? { ...c, label: '<img src=x onerror="a">' } : c));
    const out = renderWiringSVG(evil, w.netlist.nets, getPart, { locale: "en", connections });
    expect(out).not.toContain("<img");
  });

  it("names parts in Arabic in AR and keeps text at 12 px or more", () => {
    const ar = build(PLANT, "ar").svg;
    expect(ar).toContain('direction="rtl"');
    expect(ar).toContain(esc("مضخة"));
    const sizes = [...ar.matchAll(/font-size="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it("does not overlap parts", () => {
    const rects = [...svg.matchAll(/<g data-part="([^"]+)" transform="translate\(([-\d.]+) ([-\d.]+)\)">(?:<path[^>]*\/>)?<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)" height="([\d.]+)"/g)].map((m) => ({
      id: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5],
    }));
    expect(rects.length).toBeGreaterThan(3);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `${a.id} / ${b.id}`).toBe(false);
      }
  });

  it("draws a big mixed set without throwing, and an empty one", () => {
    const out = build(LIBRARY.map((p) => p.id).slice(0, 12));
    expect(out.svg.length).toBeGreaterThan(1000);
    expect(renderWiringSVG([], [], getPart, { locale: "en" })).toContain("<svg");
  });
});
