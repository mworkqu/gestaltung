import { describe, expect, it } from "vitest";

import type { NetComponent } from "./netlist";
import { safetyNote } from "./plain-safety";

const comp = (ref: string, fn: string, role?: NetComponent["role"]): NetComponent => ({ ref, function: fn, bomId: ref, pins: [], role });

describe("safetyNote (the one plain line)", () => {
  it("says nothing without a circuit", () => {
    expect(safetyNote({ netlist: null })).toBeNull();
  });

  it("is honest while something blocks: an engineer checks, never 'safe'", () => {
    expect(safetyNote({ netlist: { components: [comp("U1", "board")] }, hardCount: 2 })).toBe("engineer");
  });

  it("explains the level adapter we added", () => {
    expect(safetyNote({ netlist: { components: [comp("U1", "ESP32 board"), comp("U2", "logic level shifter")] } })).toBe("shifter");
    expect(
      safetyNote({
        netlist: { components: [comp("U1", "ESP32 board")] },
        levelFlags: [{ net: "N1", direction: "high_to_low", drivers: ["U1"], receivers: ["U2"] }],
      })
    ).toBe("shifter");
  });

  it("explains protection parts for a switched load", () => {
    expect(safetyNote({ netlist: { components: [comp("U1", "board"), comp("Q1", "driver transistor", "driver")] } })).toBe("protection");
    expect(safetyNote({ netlist: { components: [comp("U1", "board"), comp("D1", "flyback diode")] } })).toBe("protection");
  });

  it("stays quiet for a plain circuit", () => {
    expect(safetyNote({ netlist: { components: [comp("U1", "ESP32 board"), comp("S1", "PIR motion sensor")] } })).toBeNull();
  });
});
