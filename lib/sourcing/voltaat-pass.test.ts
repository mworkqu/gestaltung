import { describe, expect, it } from "vitest";

import { afterPage, afterRobots, droppedAfterPass, nextStep, parsePassState, qatarDay, type PassState } from "./voltaat-pass";

const at = (iso: string) => new Date(iso);
const pass = (over: Partial<PassState> = {}): PassState => ({
  startedAt: "2026-11-24T21:17:00.000Z", // 00:17 on the 25th in Qatar
  nextPage: 0,
  done: false,
  completedAt: null,
  prevStartedAt: null,
  failAlerted: false,
  ...over,
});

describe("qatarDay", () => {
  it("is UTC+3", () => {
    expect(qatarDay(at("2026-11-24T20:59:00Z"))).toBe("2026-11-24");
    expect(qatarDay(at("2026-11-24T21:00:00Z"))).toBe("2026-11-25");
  });
});

describe("parsePassState", () => {
  it("round-trips a state and refuses anything malformed", () => {
    expect(parsePassState(JSON.parse(JSON.stringify(pass({ nextPage: 3 }))))).toEqual(pass({ nextPage: 3 }));
    for (const bad of [null, undefined, "x", {}, { startedAt: "nope", nextPage: 1 }, { startedAt: "2026-11-24T00:00:00Z", nextPage: -1 }]) {
      expect(parsePassState(bad)).toBeNull();
    }
  });
});

describe("nextStep", () => {
  const now = at("2026-11-24T22:23:00Z"); // 01:23 on the 25th in Qatar

  it("starts with robots.txt when there is no pass yet", () => {
    const step = nextStep(null, now, "cron");
    expect(step).toMatchObject({ kind: "robots", fresh: true, state: { startedAt: now.toISOString(), nextPage: 0, prevStartedAt: null } });
  });
  it("carries on from the stored page: one page per batch", () => {
    expect(nextStep(pass({ nextPage: 4 }), now, "cron")).toMatchObject({ kind: "page", page: 4, fresh: false });
  });
  it("a finished pass means nothing more today for the schedule", () => {
    const done = pass({ nextPage: 8, done: true, completedAt: "2026-11-25T04:41:00.000Z" });
    expect(nextStep(done, at("2026-11-25T09:23:00Z"), "cron")).toEqual({ kind: "skip", reason: "already_ran_today" });
  });
  it("the next Qatar day starts a new pass and remembers the finished one", () => {
    const done = pass({ nextPage: 8, done: true });
    const step = nextStep(done, at("2026-11-25T21:23:00Z"), "cron");
    expect(step).toMatchObject({ kind: "robots", fresh: true, state: { prevStartedAt: done.startedAt, nextPage: 0, done: false } });
  });
  it("'Run now' starts another pass even when today's is finished", () => {
    const done = pass({ nextPage: 8, done: true });
    expect(nextStep(done, at("2026-11-25T09:00:00Z"), "manual")).toMatchObject({ kind: "robots", fresh: true });
  });
  it("abandons a pass stuck for 22 h without counting it as a whole pass", () => {
    const stuck = pass({ nextPage: 3, prevStartedAt: "2026-11-23T21:17:00.000Z" });
    const step = nextStep(stuck, at("2026-11-25T20:00:00Z"), "cron");
    expect(step).toMatchObject({ kind: "robots", fresh: true, state: { prevStartedAt: "2026-11-23T21:17:00.000Z" } });
  });
});

describe("afterRobots / afterPage", () => {
  it("moves one page at a time and ends on a short page", () => {
    const now = at("2026-11-25T04:41:00Z");
    expect(afterRobots(pass())).toMatchObject({ nextPage: 1, done: false });
    expect(afterPage(pass({ nextPage: 1 }), 1, 250, 250, 40, now)).toMatchObject({ nextPage: 2, done: false, completedAt: null });
    expect(afterPage(pass({ nextPage: 7 }), 7, 113, 250, 40, now)).toMatchObject({ nextPage: 8, done: true, completedAt: now.toISOString() });
    // The page cap ends a pass too.
    expect(afterPage(pass({ nextPage: 40 }), 40, 250, 250, 40, now)).toMatchObject({ done: true });
  });
});

describe("droppedAfterPass", () => {
  const state = { startedAt: "2026-11-24T21:17:00.000Z", prevStartedAt: "2026-11-23T21:19:00.000Z" };
  const offer = (id: string, last_checked_at: string | null, hasHandle = true) => ({ id, last_checked_at, hasHandle });

  it("drops only what neither this pass nor the previous one saw", () => {
    const offers = [
      offer("seen-now", "2026-11-25T01:00:00.000Z"),
      offer("seen-last-pass-only", "2026-11-24T00:30:00.000Z"),
      offer("gone-two-passes", "2026-11-22T23:00:00.000Z"),
      offer("never-checked", null),
      offer("no-link", "2026-11-01T00:00:00.000Z", false),
    ];
    expect(droppedAfterPass(offers, state).map((o) => o.id)).toEqual(["gone-two-passes", "never-checked"]);
  });
  it("drops nothing while there is no previous whole pass to compare with", () => {
    expect(droppedAfterPass([offer("old", "2026-01-01T00:00:00.000Z")], { ...state, prevStartedAt: null })).toEqual([]);
  });
});
