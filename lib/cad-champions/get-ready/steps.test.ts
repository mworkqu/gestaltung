import { describe, expect, it } from "vitest";

import {
  GET_READY_STEPS,
  GET_READY_TOTAL_MINUTES,
  REQUIRED_STEP_KEYS,
  allSubItemsTicked,
  computeGetReady,
  getReadyGate,
  isSubItemOf,
  subItemKey,
  tickedSubItems,
} from "./steps";

const allRequired = [...REQUIRED_STEP_KEYS];

describe("get ready step definitions", () => {
  it("has 7 steps, 6 required (the test-screen demo is optional)", () => {
    expect(GET_READY_STEPS).toHaveLength(7);
    expect(REQUIRED_STEP_KEYS).toHaveLength(6);
    expect(REQUIRED_STEP_KEYS).not.toContain("try_test_screen");
  });

  it("totals about 45 minutes", () => {
    expect(GET_READY_TOTAL_MINUTES).toBeGreaterThanOrEqual(40);
    expect(GET_READY_TOTAL_MINUTES).toBeLessThanOrEqual(50);
  });

  it("stores step keys that match the DB check ^[a-z0-9_]{1,64}$", () => {
    for (const s of GET_READY_STEPS) {
      expect(s.key).toMatch(/^[a-z0-9_]{1,64}$/);
      for (const sub of s.subItems) expect(subItemKey(s.key, sub)).toMatch(/^[a-z0-9_]{1,64}$/);
    }
  });

  it("checklist steps have sub-items: 5 essential actions, 7 test-day checks", () => {
    expect(GET_READY_STEPS.find((s) => s.key === "essential_actions")?.subItems).toHaveLength(5);
    expect(GET_READY_STEPS.find((s) => s.key === "test_day_checklist")?.subItems).toHaveLength(7);
  });
});

describe("sub-items", () => {
  it("builds and reads tick keys", () => {
    const stored = [subItemKey("essential_actions", "units_mm"), "essential_actions__bogus", "welcome_video"];
    expect([...tickedSubItems("essential_actions", stored)]).toEqual(["units_mm"]);
    expect(isSubItemOf("essential_actions", "export_step")).toBe(true);
    expect(isSubItemOf("essential_actions", "time_90")).toBe(false);
  });

  it("is complete only when every sub-item is ticked", () => {
    const keys = ["units_mm", "material_density", "export_step", "export_pdf"].map((k) => subItemKey("essential_actions", k));
    expect(allSubItemsTicked("essential_actions", keys)).toBe(false);
    expect(allSubItemsTicked("essential_actions", [...keys, subItemKey("essential_actions", "find_upload")])).toBe(true);
    expect(allSubItemsTicked("welcome_video", ["welcome_video"])).toBe(false);
  });
});

describe("computeGetReady", () => {
  it("starts at 0% with the welcome video next", () => {
    const s = computeGetReady([]);
    expect(s).toMatchObject({ percent: 0, complete: false, nextStep: "welcome_video" });
    expect(s.remainingRequired).toHaveLength(6);
  });

  it("ignores sub-item rows and unknown keys", () => {
    const s = computeGetReady([subItemKey("essential_actions", "units_mm"), "nope", "welcome_video"]);
    expect(s.done.size).toBe(1);
    expect(s.percent).toBe(17);
    expect(s.nextStep).toBe("check_computer");
  });

  it("is complete without the optional demo, and the next step is then the demo", () => {
    const s = computeGetReady(allRequired);
    expect(s).toMatchObject({ percent: 100, complete: true, nextStep: "try_test_screen" });
    expect(s.remainingRequired).toEqual([]);
  });

  it("the optional demo alone does not move the percentage", () => {
    expect(computeGetReady(["try_test_screen"]).percent).toBe(0);
  });

  it("next step is null when all 7 are done", () => {
    expect(computeGetReady([...allRequired, "try_test_screen"]).nextStep).toBeNull();
  });
});

describe("getReadyGate", () => {
  const profile = { get_ready_bypass: false };

  it("blocks without a profile", () => {
    expect(getReadyGate(null, null)).toMatchObject({ ready: false, reasonKey: "no_profile" });
  });

  it("opens when an admin set the bypass", () => {
    expect(getReadyGate({ get_ready_bypass: true }, null)).toEqual({ ready: true, reasonKey: "bypassed", remaining: 0 });
  });

  it("opens when the journey says Get Ready is complete", () => {
    expect(getReadyGate(profile, { get_ready_completed_at: "2026-10-14T10:00:00Z" })).toEqual({
      ready: true,
      reasonKey: "ready",
      remaining: 0,
    });
  });

  it("counts the steps left from stepsDone", () => {
    expect(getReadyGate(profile, null, ["welcome_video", "check_computer", "install_software"])).toEqual({
      ready: false,
      reasonKey: "not_finished",
      remaining: 3,
    });
  });

  it("opens from stepsDone even before the journey stamp is written", () => {
    expect(getReadyGate(profile, { get_ready_completed_at: null }, allRequired).ready).toBe(true);
  });

  it("without stepsDone an unfinished student has every required step left", () => {
    expect(getReadyGate(profile, null).remaining).toBe(6);
  });
});
