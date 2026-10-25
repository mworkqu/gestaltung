import { describe, expect, it } from "vitest";

import { countOverdueJobs, jobDue } from "@/lib/engineering/view";

const now = Date.parse("2026-10-22T12:00:00Z");

describe("jobDue", () => {
  it("hours and minutes to the ETA of an open job", () => {
    expect(jobDue({ eta_at: "2026-10-22T14:05:00Z", status: "queued" }, now)).toEqual({ late: false, hours: 2, minutes: 5 });
    expect(jobDue({ eta_at: "2026-10-22T12:00:00Z", status: "in_progress" }, now)).toEqual({ late: false, hours: 0, minutes: 0 });
  });
  it("late once the ETA has passed", () => {
    expect(jobDue({ eta_at: "2026-10-22T10:30:00Z", status: "in_progress" }, now)).toEqual({ late: true, hours: 1, minutes: 30 });
    expect(jobDue({ eta_at: "2026-10-20T11:59:00Z", status: "queued" }, now)).toEqual({ late: true, hours: 48, minutes: 1 });
  });
  it("rounds to the nearest minute (under half a minute late is not late)", () => {
    expect(jobDue({ eta_at: "2026-10-22T11:59:40Z", status: "queued" }, now)).toEqual({ late: false, hours: 0, minutes: 0 });
    expect(jobDue({ eta_at: "2026-10-22T11:59:20Z", status: "queued" }, now)).toEqual({ late: true, hours: 0, minutes: 1 });
    expect(jobDue({ eta_at: "2026-10-22T12:00:31Z", status: "queued" }, now)).toEqual({ late: false, hours: 0, minutes: 1 });
  });
  it("no ETA, or not open: nothing", () => {
    expect(jobDue({ eta_at: null, status: "queued" }, now)).toBeNull();
    for (const status of ["ready", "failed", "cancelled"]) {
      expect(jobDue({ eta_at: "2026-10-22T10:00:00Z", status }, now)).toBeNull();
    }
  });
});

describe("countOverdueJobs", () => {
  it("counts ETAs strictly before now; no ETA is not overdue", () => {
    const rows = [
      { eta_at: "2026-10-22T11:59:59Z" },
      { eta_at: "2026-10-22T12:00:00Z" },
      { eta_at: "2026-10-23T00:00:00Z" },
      { eta_at: null },
      { eta_at: "2026-10-01T00:00:00Z" },
    ];
    expect(countOverdueJobs(rows, now)).toBe(2);
    expect(countOverdueJobs([], now)).toBe(0);
  });
});
