import { describe, expect, it } from "vitest";

import { branches, initialNode, visibleNodes, withBranchChoice, type Branch, type NodeId } from "./tree";

const branch = (discipline: Branch["discipline"], active: boolean): Branch => ({
  discipline,
  detected: active,
  manual: undefined,
  partCount: 0,
  active,
});

const mechOnly = visibleNodes([branch("mechanical", true), branch("electronics", false), branch("software", false)]);
const all = visibleNodes([branch("mechanical", true), branch("electronics", true), branch("software", true)]);
const noBranches = visibleNodes([branch("mechanical", false), branch("electronics", false), branch("software", false)]);

const spec = { summary: "", rows: [], questions: [] };

describe("initialNode: the workspace opens where the client left off (audit #32)", () => {
  it("a new project opens on Brief", () => {
    expect(initialNode({ stage: "idea" }, all)).toBe("brief");
  });

  it("an unanalysed project opens on Brief even if a node was stored", () => {
    expect(initialNode({ stage: "quote", spec: null, parts: [] }, all)).toBe("brief");
    expect(initialNode({ stage: "mechanical.parts", spec: null, disciplines: { detected: [] } }, all)).toBe("brief");
  });

  it("an analysed project opens on the stored node", () => {
    expect(initialNode({ stage: "mechanical.parts", spec }, all)).toBe("mechanical.parts");
    expect(initialNode({ stage: "electronics.power", spec }, all)).toBe("electronics.power");
    expect(initialNode({ stage: "bom", spec }, all)).toBe("bom");
  });

  it("an analysed project that left off on Quote reopens on Quote", () => {
    expect(initialNode({ stage: "quote", spec }, all)).toBe("quote");
  });

  it("parts or detected disciplines count as started (projects analysed before the spec was stored)", () => {
    expect(initialNode({ stage: "parts", spec: null, parts: [{}] }, all)).toBe("parts");
    expect(initialNode({ stage: "parts", disciplines: { detected: ["mechanical"] } }, all)).toBe("parts");
  });

  it("maps the old stage ids from before the tree", () => {
    const cases: [string, NodeId][] = [
      ["idea", "brief"],
      ["concepts", "concepts"],
      ["parts", "parts"],
      ["design", "mechanical.drawings"],
      ["engineering", "mechanical.process"],
      ["manufacturing", "mechanical.process"],
    ];
    for (const [stored, want] of cases) expect(initialNode({ stage: stored, spec }, mechOnly)).toBe(want);
  });

  it("a legacy id whose branch is gone falls back to Brief, not Quote", () => {
    expect(initialNode({ stage: "manufacturing", spec }, noBranches)).toBe("brief");
    expect(initialNode({ stage: "design", spec }, noBranches)).toBe("brief");
  });

  it("a stored node from a removed branch falls back to Brief", () => {
    expect(initialNode({ stage: "software.scope", spec }, mechOnly)).toBe("brief");
  });

  it("an unknown, empty or missing stage falls back to Brief", () => {
    expect(initialNode({ stage: "nonsense", spec }, all)).toBe("brief");
    expect(initialNode({ stage: "", spec }, all)).toBe("brief");
    expect(initialNode({ stage: null, spec }, all)).toBe("brief");
    expect(initialNode({ stage: undefined, spec }, all)).toBe("brief");
  });

  it("never falls back to Quote", () => {
    for (const stage of ["", "idea", "x", "manufacturing", "software.scope"]) {
      expect(initialNode({ stage, spec }, noBranches)).not.toBe("quote");
    }
  });
});

describe("withBranchChoice: add, remove, restore", () => {
  it("records a manual on/off beside what was detected", () => {
    const s = { detected: ["mechanical" as const] };
    expect(withBranchChoice(s, "software", true)).toEqual({ detected: ["mechanical"], manual: { software: true } });
    expect(withBranchChoice(s, "mechanical", false)).toEqual({ detected: ["mechanical"], manual: { mechanical: false } });
  });

  it("restore clears the manual choice, so detection decides again", () => {
    const removed = withBranchChoice({ detected: ["electronics"] }, "electronics", false);
    expect(branches(removed, null, []).find((b) => b.discipline === "electronics")?.active).toBe(false);
    const restored = withBranchChoice(removed, "electronics", "restore");
    expect(restored).toEqual({ detected: ["electronics"], manual: {} });
    const b = branches(restored, null, []).find((x) => x.discipline === "electronics");
    expect(b?.active).toBe(true);
    expect(b?.manual).toBeUndefined();
  });

  it("restore leaves other disciplines' choices alone", () => {
    const s = { manual: { mechanical: false, software: true } };
    expect(withBranchChoice(s, "mechanical", "restore")).toEqual({ manual: { software: true } });
  });

  it("works from no state at all", () => {
    expect(withBranchChoice(null, "software", "restore")).toEqual({ manual: {} });
    expect(withBranchChoice(undefined, "software", true)).toEqual({ manual: { software: true } });
  });
});
