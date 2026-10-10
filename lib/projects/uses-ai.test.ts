import { describe, expect, it } from "vitest";

import { projectUsesAi } from "./uses-ai";

describe("projectUsesAi", () => {
  it("is false for a drawing-only project", () => {
    expect(projectUsesAi({ spec: null, bom: null, netlist: null })).toBe(false);
    expect(projectUsesAi({})).toBe(false);
  });
  it("is true once the AI consent, a parts list or a circuit exists", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spec: any = { rows: [], questions: [], aiConsent: { at: "x", destination: "y" } };
    expect(projectUsesAi({ spec })).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(projectUsesAi({ bom: { lines: [{}] } as any })).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(projectUsesAi({ netlist: {} as any })).toBe(true);
  });
});
