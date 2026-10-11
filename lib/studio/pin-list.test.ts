import { describe, expect, it } from "vitest";
import { buildConnections } from "./connections";
import { getPart } from "./library";
import { buildWiring } from "./netlist";
import { guideLine, pinListRows, pinListText } from "./pin-list";
import { DEFAULT_SPEC } from "./schema";

const comps = (...ids: string[]) => ids.map((id, i) => ({ partId: id, instanceId: `${id}_${i + 1}`, label: id }));

const SETS = [
  ["esp32_devkit", "soil_moisture_cap", "pump_5v", "motor_driver", "led_5mm", "usbc_power_5v"],
  ["arduino_uno", "led_5mm", "button_6mm"],
];

describe.each(SETS)("pin list %s", (...ids) => {
  const w = buildWiring(comps(...ids), DEFAULT_SPEC, getPart, "en");
  const conns = buildConnections(w.components, w.netlist.nets, getPart);
  for (const locale of ["en", "ar"] as const) {
    it(`one row per connection (${locale})`, () => {
      const rows = pinListRows(conns, getPart, locale);
      expect(conns.length).toBeGreaterThan(0);
      expect(rows.map((r) => r.id)).toEqual(conns.map((c) => c.id));
      expect(rows.map((r) => r.colour)).toEqual(conns.map((c) => c.wireColour));
      expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
      expect(pinListText(rows, locale).split("\n")).toHaveLength(rows.length + 1);
    });
  }
  it("board pin matches a connection end and ground is first", () => {
    const rows = pinListRows(conns, getPart, "en");
    rows.forEach((r, i) => {
      const c = conns[i];
      expect([c.from.label, c.to.label]).toContain(r.boardPinLabel);
    });
    const firstNonGround = conns.findIndex((c) => c.role !== "ground");
    expect(conns.slice(0, firstNonGround).every((c) => c.role === "ground")).toBe(true);
    expect(rows[0].note).toMatch(/black/i);
    expect(conns.slice(firstNonGround).some((c) => c.role === "ground")).toBe(false);
  });
  it("guide line", () => {
    const line = guideLine(conns[0], 0, conns.length, getPart, "en");
    expect(line).toContain(`Wire 1 of ${conns.length}: black`);
  });
});

it("names the resistor for a via connection", () => {
  const w = buildWiring(comps(...SETS[1]), DEFAULT_SPEC, getPart, "en");
  const conns = buildConnections(w.components, w.netlist.nets, getPart);
  const via = conns.findIndex((c) => c.viaPart);
  if (via >= 0) {
    expect(pinListRows(conns, getPart, "en")[via].note).toMatch(/^Through the/);
    expect(guideLine(conns[via], via, conns.length, getPart, "en")).toContain("through the");
  }
});
