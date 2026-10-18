import { describe, expect, it } from "vitest";

import { emptyStudioDoc, clampSpec, type StudioDoc } from "@/lib/studio/schema";
import { ENGINEER_SERVICES_DEFAULT, connectionCount, parseEngineerServices, quoteService, serviceReady } from "./quote";

const doc = (parts: number, nets: number[]): StudioDoc => ({
  ...emptyStudioDoc(clampSpec({ name: "Arm", oneLine: "x", actuators: [{ kind: "servo", count: 4, load: "light" }] })),
  components: Array.from({ length: parts }, (_, i) => ({ partId: `p${i}`, instanceId: `i${i}`, label: `P${i}` })),
  netlist: { nets: nets.map((n, i) => ({ name: `N${i}`, pins: Array.from({ length: n }, (_, j) => `i${j}.x`) })) },
});

describe("engineer service quotes", () => {
  it("connections = pins − 1 per net", () => {
    expect(connectionCount(doc(3, [2, 3, 1]))).toBe(3);
  });
  it("assembly = base + per component + per wire, rounded up", () => {
    const q = quoteService("assembly", doc(10, [4, 4, 2]));
    const p = ENGINEER_SERVICES_DEFAULT.assembly;
    const raw = p.base_qar + 10 * p.per_component_qar + 7 * p.per_connection_qar;
    expect(q.total_qar).toBe(Math.ceil(raw / ENGINEER_SERVICES_DEFAULT.round_to_qar) * ENGINEER_SERVICES_DEFAULT.round_to_qar);
    expect(q.lines.map((l) => l.key)).toEqual(["base", "components", "connections"]);
    expect(q.connections).toBe(7);
  });
  it("CAD by an engineer never goes below the base and grows with complexity", () => {
    const small = quoteService("cad_engineer", doc(1, []));
    const big = quoteService("cad_engineer", doc(20, []));
    expect(small.total_qar).toBeGreaterThanOrEqual(ENGINEER_SERVICES_DEFAULT.cad_engineer.base_qar);
    expect(big.total_qar).toBeGreaterThan(small.total_qar);
    expect(big.hours).toBeGreaterThan(small.hours!);
  });
  it("needs parts; assembly and PCB need the wiring", () => {
    expect(serviceReady("assembly", doc(3, []))).toBe(false);
    expect(serviceReady("cad_engineer", doc(3, []))).toBe(true);
    expect(serviceReady("pcb_gerber", doc(0, [2]))).toBe(false);
    expect(serviceReady("pcb_gerber", null)).toBe(false);
  });
  it("bad admin prices fall back to the defaults", () => {
    expect(parseEngineerServices({ assembly: "x" })).toEqual(ENGINEER_SERVICES_DEFAULT);
  });
});
