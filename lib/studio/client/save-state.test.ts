import { describe, expect, it } from "vitest";

import { emptyStudioDoc } from "../schema";
import { saveStatus, shouldWarnOnLeave, stepChangeSave } from "./save-state";
import { FLOW } from "./steps";

describe("studio autosave rules (D4)", () => {
  it("triggers a save on every step change", () => {
    let doc = emptyStudioDoc();
    // First step differs from the empty doc's lastStep (or equals it: walk from a different one).
    doc = { ...doc, lastStep: undefined };
    for (const step of FLOW) {
      const r = stepChangeSave(doc, step);
      expect(r.save, `moving to ${step}`).toBe(true);
      expect(r.doc?.lastStep).toBe(step);
      doc = r.doc!;
    }
    // Walking back is a change too.
    expect(stepChangeSave(doc, "idea").save).toBe(true);
  });

  it("does not save when the step did not change or there is no doc yet", () => {
    const doc = { ...emptyStudioDoc(), lastStep: "parts" as const };
    const same = stepChangeSave(doc, "parts");
    expect(same.save).toBe(false);
    expect(same.doc).toBe(doc);
    expect(stepChangeSave(null, "parts")).toEqual({ doc: null, save: false });
  });

  it("derives the indicator status", () => {
    expect(saveStatus({ dirty: false, inFlight: false, failed: false })).toBe("saved");
    expect(saveStatus({ dirty: true, inFlight: false, failed: false })).toBe("saving");
    expect(saveStatus({ dirty: false, inFlight: true, failed: false })).toBe("saving");
    expect(saveStatus({ dirty: true, inFlight: false, failed: true })).toBe("failed");
  });

  it("warns on leave only for unsaved work that can be saved", () => {
    expect(shouldWarnOnLeave("saved", true)).toBe(false);
    expect(shouldWarnOnLeave("saving", true)).toBe(true);
    expect(shouldWarnOnLeave("failed", true)).toBe(true);
    expect(shouldWarnOnLeave("saving", false)).toBe(false);
  });
});
