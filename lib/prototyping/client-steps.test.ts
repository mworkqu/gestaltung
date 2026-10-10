import { describe, expect, it } from "vitest";

import { clientAlternatives, deriveClientSteps, needsWiring, wiringCostKind, type ClientStepFacts } from "./client-steps";

const base: ClientStepFacts = { analysed: false, hasParts: false, partsHandled: false, needsWiring: true, wiringDone: false };
const ids = (f: ClientStepFacts) => deriveClientSteps(f).map((s) => `${s.id}:${s.status}`);

describe("deriveClientSteps", () => {
  it("a new project: only the idea is current, the rest wait", () => {
    expect(ids(base)).toEqual(["idea:current", "parts:upcoming", "wiring:upcoming", "make:upcoming"]);
  });

  it("after the idea is read the parts step is current", () => {
    expect(ids({ ...base, analysed: true, hasParts: true })).toEqual(["idea:done", "parts:current", "wiring:upcoming", "make:upcoming"]);
  });

  it("parts in the cart: wiring is next; then get it made", () => {
    const f = { ...base, analysed: true, hasParts: true, partsHandled: true };
    expect(ids(f)).toEqual(["idea:done", "parts:done", "wiring:current", "make:upcoming"]);
    expect(ids({ ...f, wiringDone: true })).toEqual(["idea:done", "parts:done", "wiring:done", "make:current"]);
  });

  it("a project with no electronics has three steps, numbered 1 to 3", () => {
    const steps = deriveClientSteps({ ...base, needsWiring: false, analysed: true, hasParts: true });
    expect(steps.map((s) => s.id)).toEqual(["idea", "parts", "make"]);
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3]);
  });

  it("only one step is ever current; the last step is never 'done'", () => {
    const all = deriveClientSteps({ analysed: true, hasParts: true, partsHandled: true, needsWiring: true, wiringDone: true });
    expect(all.filter((s) => s.status === "current")).toHaveLength(1);
    expect(all.at(-1)?.status).toBe("current");
  });

  it("no parts is not 'handled'", () => {
    expect(ids({ ...base, analysed: true, hasParts: false, partsHandled: true }).includes("parts:done")).toBe(false);
  });
});

describe("needsWiring", () => {
  it("applies to electronics projects only", () => {
    expect(needsWiring({ electronicsActive: false, hasElectronicsLines: false, hasNetlist: false })).toBe(false);
    expect(needsWiring({ electronicsActive: true, hasElectronicsLines: false, hasNetlist: false })).toBe(true);
    expect(needsWiring({ electronicsActive: false, hasElectronicsLines: true, hasNetlist: false })).toBe(true);
    expect(needsWiring({ electronicsActive: false, hasElectronicsLines: false, hasNetlist: true })).toBe(true);
  });
});

describe("wiringCostKind (never claims free when it is not)", () => {
  it("free only when the database says the step costs nothing (admin)", () => {
    expect(wiringCostKind({ cost: "none" })).toBe("free");
  });
  it("a credit for a user, and for anything unknown", () => {
    expect(wiringCostKind({ cost: "credit" })).toBe("credit");
    expect(wiringCostKind({ cost: "included" })).toBe("credit");
    expect(wiringCostKind({ cost: null })).toBe("credit");
    expect(wiringCostKind(null)).toBe("credit");
    expect(wiringCostKind(undefined)).toBe("credit");
    expect(wiringCostKind({ cost: "free" })).toBe("credit");
  });
});

describe("clientAlternatives", () => {
  it("offers only strong, non-doubtful alternatives to the current part", () => {
    const list = [
      { id: "a", strength: "strong" },
      { id: "b", strength: "strong" },
      { id: "c", strength: "weak" },
      { id: "d", strength: "strong", doubt: true },
    ];
    expect(clientAlternatives(list, "a").map((x) => x.id)).toEqual(["b"]);
    expect(clientAlternatives(list, null).map((x) => x.id)).toEqual(["a", "b"]);
  });
});
