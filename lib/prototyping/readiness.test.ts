import { describe, expect, it } from "vitest";

import { deriveElectronics } from "./electronics-rules";
import { projectBoards } from "./footprints";
import { plantLines, plantNetlist, tKey } from "./plant-monitor.fixture";
import { projectReadiness, type ReadinessInput } from "./readiness";
import { branches, nodeOf, nodeStates, visibleNodes } from "./tree";
import type { Netlist } from "./netlist";

const input = (netlist: Netlist | null): ReadinessInput => ({
  brief: "A plant monitor that waters the plant when the soil is dry and shows its state on four LEDs.",
  spec: null,
  parts: [],
  routeAccepted: false,
  electronics: { route: "prototype", built: true, netlist },
});

describe("readiness: circuit_clean (audit #1)", () => {
  const raw = plantNetlist();
  const augmented = deriveElectronics({ netlist: raw, lines: plantLines, route: "prototype", power: null, t: tKey }).netlist!;
  // The same circuit without the supply conflict: what a clean build looks like.
  const clean = structuredClone(augmented);
  clean.components.find((c) => c.ref === "U1")!.pins.find((p) => p.id === "5V")!.type = "power_in";

  it("blocks on every hard flag, one requirement each, and the percent drops", () => {
    const bad = projectReadiness(input(raw), tKey);
    const circuit = bad.requirements.filter((r) => r.id === "circuit_clean" || r.id.startsWith("circuit:"));
    expect(circuit.map((r) => [r.id, r.satisfied])).toEqual([
      ["circuit_clean", false],
      ["circuit:inductive_on_gpio:M1", false],
      ["circuit:led_no_resistor:LED1", false],
      ["circuit:led_no_resistor:LED2", false],
      ["circuit:led_no_resistor:LED3", false],
      ["circuit:led_no_resistor:LED4", false],
      ["circuit:shorted_supplies:5V", false],
    ]);
    expect(circuit.every((r) => r.blockingReason && r.focus === "circuit-card")).toBe(true);
    expect(circuit[1].blockingReason).toContain("hard_inductive_on_gpio");

    const ok = projectReadiness(input(clean), tKey);
    expect(ok.requirements.find((r) => r.id === "circuit_clean")?.satisfied).toBe(true);
    expect(ok.requirements.some((r) => r.id.startsWith("circuit:"))).toBe(false);
    expect(bad.percent).toBeLessThan(ok.percent);
  });

  it("after our rules only the supply conflict is left", () => {
    const r = projectReadiness(input(augmented), tKey);
    expect(r.requirements.filter((x) => x.id.startsWith("circuit:")).map((x) => x.id)).toEqual(["circuit:shorted_supplies:5V"]);
  });

  it("with no circuit yet, circuit_clean asks for one", () => {
    const r = projectReadiness(input(null), tKey);
    expect(r.requirements.find((x) => x.id === "circuit_clean")).toMatchObject({ satisfied: false, blockingReason: "block_circuitMissing" });
  });

  it("the tree counts them on Electronics › Components, where the circuit is shown", () => {
    const r = projectReadiness(input(raw), tKey);
    const visible = visibleNodes(branches({ manual: { electronics: true } }, null, []));
    const states = nodeStates(r, [], null, visible, tKey, "prototype");
    const components = states["electronics.components"].open.map((x) => x.id);
    expect(components).toContain("circuit_clean");
    expect(components).toContain("circuit:shorted_supplies:5V");
    expect(states["electronics.board"].open.map((x) => x.id)).not.toContain("circuit_clean");
    expect(nodeOf(r.requirements.find((x) => x.id === "circuit_clean")!, [], visible)).toBe("electronics.components");
  });
});

describe("readiness: an enclosure too small for its board (audit #5)", () => {
  const box = {
    id: "e",
    code: "P-01",
    name: "Enclosure shell",
    source: "to_design" as const,
    kind: "mechanical" as const,
    status: "confirmed",
    material: "pla",
    process: "3d_printing",
    shape: "block",
    length_mm: 30,
    width_mm: 30,
    height_mm: 20,
  };
  const base: ReadinessInput = { ...input(null), electronics: null, parts: [box] };
  // The board comes from the project's own lines, as the workspace passes it.
  const boards = projectBoards({ bom: { lines: plantLines }, partNames: [], itemNames: [] });

  it("blocks the part (tooSmall) and the route, and the percent drops", () => {
    const blind = projectReadiness(base, tKey);
    const seen = projectReadiness({ ...base, boards }, tKey);
    expect(blind.requirements.find((r) => r.id === "part:e")?.satisfied).toBe(true);
    expect(seen.requirements.find((r) => r.id === "part:e")).toMatchObject({ satisfied: false });
    expect(seen.requirements.find((r) => r.id === "part:e")?.blockingReason).toContain("partNeed_tooSmall");
    expect(seen.percent).toBeLessThan(blind.percent);
  });

  it("an enclosure big enough is not blocked", () => {
    const r = projectReadiness({ ...base, boards, parts: [{ ...box, length_mm: 80, width_mm: 50, height_mm: 30 }] }, tKey);
    expect(r.requirements.find((x) => x.id === "part:e")?.satisfied).toBe(true);
  });
});

describe("readiness: a circuit part whose line was removed (review round 1)", () => {
  const r = deriveElectronics({ netlist: plantNetlist(), lines: plantLines, route: "prototype", power: null, t: tKey });
  const n = r.netlist!;
  n.components.find((c) => c.ref === "U1")!.pins.find((p) => p.id === "5V")!.type = "power_in";
  const all = [...plantLines, ...r.lines].map((l) => l.id);

  it("is clean while every part has its line", () => {
    const ok = projectReadiness({ ...input(n), electronics: { route: "prototype", built: true, netlist: n, lineIds: all } }, tKey);
    expect(ok.requirements.find((x) => x.id === "circuit_clean")?.satisfied).toBe(true);
  });

  it("blocks once per orphaned part when rule_res_150 is removed", () => {
    const live = all.filter((id) => id !== "rule_res_150");
    const bad = projectReadiness({ ...input(n), electronics: { route: "prototype", built: true, netlist: n, lineIds: live } }, tKey);
    expect(bad.requirements.find((x) => x.id === "circuit_clean")?.satisfied).toBe(false);
    expect(bad.requirements.filter((x) => x.id.startsWith("circuit:orphan:")).map((x) => x.id)).toEqual([
      "circuit:orphan:R_LED1",
      "circuit:orphan:R_LED2",
      "circuit:orphan:R_LED3",
      "circuit:orphan:R_LED4",
    ]);
  });
});
