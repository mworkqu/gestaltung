import { describe, expect, it } from "vitest";

import { REQUEST_SENT_KEY } from "@/lib/studio/request-summary";
import { deriveProjectStatus } from "./item-status";
import { studioCardFacts } from "./studio-facts";

describe("studioCardFacts (F-043)", () => {
  it("counts the doc's parts array, not the legacy tables", () => {
    const parts = Array.from({ length: 9 }, (_, i) => ({ instanceId: `p${i}`, partId: "x" }));
    expect(studioCardFacts(parts, {}).parts).toBe(9);
  });
  it("is zero for a project with no doc yet", () => {
    expect(studioCardFacts(null, null)).toEqual({ parts: 0, quoteRequested: false });
    expect(studioCardFacts(undefined, undefined)).toEqual({ parts: 0, quoteRequested: false });
  });
  it("sees a sent request", () => {
    expect(studioCardFacts([], { [REQUEST_SENT_KEY]: "2026-10-11T08:00:00.000Z" }).quoteRequested).toBe(true);
    expect(studioCardFacts([], { [REQUEST_SENT_KEY]: "" }).quoteRequested).toBe(false);
    expect(studioCardFacts([], { idea: "x" }).quoteRequested).toBe(false);
  });
});

describe("deriveProjectStatus with a quote request", () => {
  it("shows Quote requested instead of Planning, but an order still wins", () => {
    expect(deriveProjectStatus({ hasLiveOrder: false, hasCartLine: false, quoteRequested: true })).toBe("quote_requested");
    expect(deriveProjectStatus({ hasLiveOrder: false, hasCartLine: true, quoteRequested: true })).toBe("quote_requested");
    expect(deriveProjectStatus({ hasLiveOrder: true, hasCartLine: false, quoteRequested: true })).toBe("ordered");
  });
});
