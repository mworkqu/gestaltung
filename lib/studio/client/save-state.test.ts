import { describe, expect, it, vi } from "vitest";

import { emptyStudioDoc } from "../schema";
import type { SaveResult } from "./api";
import { saveStatus, saveWithConflictRetry, shouldWarnOnLeave, stepChangeSave } from "./save-state";
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

describe("saveWithConflictRetry", () => {
  const doc = emptyStudioDoc();
  const conflict = (version: number): SaveResult => ({ ok: false, error: "conflict", doc: null, version });

  it("saves once when there is no conflict", async () => {
    const save = vi.fn(async () => ({ ok: true, version: 4 }) as SaveResult);
    expect(await saveWithConflictRetry(save, doc, 3)).toEqual({ ok: true, version: 4 });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("retries once on the server's version after a 409 and keeps our doc", async () => {
    const save = vi.fn<(d: typeof doc, v: number) => Promise<SaveResult>>();
    save.mockResolvedValueOnce(conflict(7)).mockResolvedValueOnce({ ok: true, version: 8 });
    expect(await saveWithConflictRetry(save, doc, 3)).toEqual({ ok: true, version: 8 });
    expect(save.mock.calls).toEqual([[doc, 3], [doc, 7]]);
  });

  it("gives up after one retry so the caller can adopt the other writer's doc", async () => {
    const save = vi.fn(async () => conflict(9));
    expect(await saveWithConflictRetry(save, doc, 3)).toEqual(conflict(9));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not retry other failures", async () => {
    const save = vi.fn(async () => ({ ok: false, error: "failed" }) as SaveResult);
    await saveWithConflictRetry(save, doc, 3);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
