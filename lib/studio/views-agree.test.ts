// P5-17 acceptance: one netlist → every view and the code agree (ids, colours, pins).
import { describe, expect, it } from "vitest";
import { esc } from "@/lib/prototyping/netlist";
import { GOLDEN_IDEAS } from "./product/__fixtures__/golden";
import { buildConnections, pinBlock, pinConstants, WIRE_HEX, WIRE_OUTLINE, type Connection } from "./connections";
import { getPart } from "./library";
import { buildWiring } from "./netlist";
import { pinListRows } from "./pin-list";
import { renderSchematicSVG } from "./schematic";
import { DEFAULT_SPEC, type StudioComponent } from "./schema";
import { renderWiringSVG } from "./wiring-drawing";
import { layoutMat } from "./wiring3d/layout";
import { wireProblems } from "./wiring3d/verify";
import { buildWires } from "./wiring3d/wires";

const comps = (ids: string[]): StudioComponent[] => ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));
const golden = (key: string) => GOLDEN_IDEAS.find((g) => g.key === key)!.partIds;

const FIXTURES: Record<string, string[]> = {
  "Plant Waterer": ["esp32_devkit", "soil_moisture_cap", "pump_5v", "led_5mm", "usbc_power_5v"],
  "desk lamp": golden("desk_lamp"),
  "cat feeder": golden("cat_feeder"),
  doorbell: golden("doorbell"),
};

const reEsc = (s: string) => s.replace(/[-/\^$*+?.()|[\]{}]/g, "\$&");
const tagsWith = (svg: string, attr: string) => [...svg.matchAll(new RegExp(`<[a-z]+ [^>]*${reEsc(attr)}[^>]*>`, "g"))].map((m) => m[0]);

describe.each(Object.entries(FIXTURES))("views agree: %s", (_name, ids) => {
  const w = buildWiring(comps(ids), DEFAULT_SPEC, getPart, "en");
  const connections: Connection[] = buildConnections(w.components, w.netlist.nets, getPart);
  const nets = w.netlist.nets;

  it("has wires", () => {
    expect(connections.length).toBeGreaterThan(2);
    expect(new Set(connections.map((c) => c.id)).size).toBe(connections.length);
  });

  it("Wiring SVG: every connection id drawn in its wire colour", () => {
    const svg = renderWiringSVG(w.components, nets, getPart, { locale: "en", connections });
    for (const c of connections) {
      const mains = tagsWith(svg, `class="wire-main" data-conn="${c.id}"`);
      expect(mains.length, c.id).toBeGreaterThan(0);
      for (const t of mains) {
        expect(t, c.id).toContain(`stroke="${WIRE_HEX[c.wireColour]}"`);
        expect(t, c.id).toContain(`data-colour="${c.wireColour}"`);
      }
    }
  });

  it("Schematic SVG: every connection's net drawn in the same colour", () => {
    const svg = renderSchematicSVG(w.components, nets, getPart, { locale: "en", connections });
    for (const c of connections) {
      const hex = c.wireColour === "white" ? WIRE_OUTLINE.white! : WIRE_HEX[c.wireColour];
      const tags = tagsWith(svg, `data-net="${esc(c.net)}"`);
      expect(tags.length, `${c.id} net ${c.net}`).toBeGreaterThan(0);
      const html = svg.slice(svg.indexOf(`data-net="${esc(c.net)}"`));
      expect(html, `${c.id} ${hex}`).toContain(hex);
      expect(tags.some((t) => t.includes(`stroke="${hex}"`) || t.includes(`fill="${hex}"`)) || svg.includes(`stroke="${hex}"`), c.id).toBe(true);
    }
  });

  it("3D wires on the breadboard: same ids and colours, every end on its pin or a hole of its net", () => {
    const items = w.components.flatMap((c) => {
      const p = getPart(c.partId);
      return p ? [{ instanceId: c.instanceId, part: p }] : [];
    });
    const layout = layoutMat(items, connections, nets);
    expect(layout.breadboard).not.toBeNull();
    const segs = buildWires({ connections, layout, getPart, nets });
    expect(new Set(segs.map((s) => s.id))).toEqual(new Set(connections.map((c) => c.id)));
    for (const c of connections) {
      const mine = segs.filter((s) => s.id === c.id);
      expect(mine.length, c.id).toBeGreaterThan(0);
      expect(mine.every((s) => s.colour === c.wireColour)).toBe(true);
    }
    expect(wireProblems(segs, connections, layout, getPart, nets)).toEqual([]);
  });

  it("Pin list: one row per connection, same id, colour and board pin label", () => {
    const rows = pinListRows(connections, getPart, "en");
    expect(rows.map((r) => r.id)).toEqual(connections.map((c) => c.id));
    rows.forEach((r, i) => {
      const c = connections[i];
      expect(r.colour).toBe(c.wireColour);
      expect([c.from.label, c.to.label]).toContain(r.boardPinLabel);
      expect(r.net).toBe(c.net);
    });
  });

  it("Code pin block: every board signal connection with a constant has the right value and comment id", () => {
    const constants = pinConstants(connections, getPart);
    const block = pinBlock(constants);
    const board = connections.filter(
      (c) => c.role !== "power" && c.role !== "ground" && getPart(c.from.partId)?.category === "mcu" && /^(GPIO|GP|IO|D|A)\d+$/i.test(c.from.pin),
    );
    expect(board.length).toBeGreaterThan(0);
    for (const c of board) {
      const k = constants.find((x) => x.connectionIds.includes(c.id));
      expect(k, c.id).toBeDefined();
      const line = block.split("\n").find((l) => l.startsWith(`const int ${k!.name} =`))!;
      expect(line, c.id).toBeDefined();
      expect(line).toMatch(new RegExp(`= ${reEsc(k!.value)};`));
      expect(line).toContain(`${c.wireColour} wire`);
      expect(line).toContain(c.id);
      expect(k!.value).toBe(/^A/i.test(c.from.pin) ? `A${Number(c.from.pin.slice(1))}` : String(Number(c.from.pin.replace(/\D/g, ""))));
    }
  });
});
