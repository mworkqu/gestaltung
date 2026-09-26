import { describe, expect, it } from "vitest";

import { nodeClick } from "./node-click";

describe("nodeClick: a sidebar row is never a dead click (audit #30)", () => {
  it("opens an unblocked node", () => {
    expect(nodeClick("quote", { open: [] }, "brief")).toEqual({ to: "quote" });
  });

  it("opens a node with no state at all", () => {
    expect(nodeClick("production", undefined, "brief")).toEqual({ to: "production" });
  });

  it("goes to the fix when it lives elsewhere, focusing its control", () => {
    const st = { open: [], reason: "needs quantity", target: "brief" as const, focus: "fact-quantity" };
    expect(nodeClick("quote", st, "parts")).toEqual({ to: "brief", focus: "fact-quantity" });
  });

  it("goes to the fix without a focus when none is given", () => {
    const st = { open: [], reason: "needs confirmed parts", target: "parts" as const };
    expect(nodeClick("quote", st, "brief")).toEqual({ to: "parts" });
  });

  it("already on the fix with a control: brings the control into view", () => {
    const st = { open: [], reason: "needs quantity", target: "brief" as const, focus: "fact-quantity" };
    expect(nodeClick("quote", st, "brief")).toEqual({ to: "brief", focus: "fact-quantity" });
  });

  it("already on the fix without a control: opens the node itself", () => {
    const st = { open: [], reason: "needs a concept kept", target: "software.concepts" as const };
    expect(nodeClick("software.scope", st, "software.concepts")).toEqual({ to: "software.scope" });
  });

  it("a reason whose fix is the node itself opens the node", () => {
    const st = { open: [], reason: "needs a software part", target: "software.scope" as const };
    expect(nodeClick("software.scope", st, "brief")).toEqual({ to: "software.scope" });
  });

  it("a reason with no target opens the node", () => {
    expect(nodeClick("production", { open: [], reason: "x" }, "brief")).toEqual({ to: "production" });
  });
});
