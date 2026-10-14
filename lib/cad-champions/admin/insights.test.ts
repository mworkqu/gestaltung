import { describe, expect, it } from "vitest";

import { moduleReadiness, type ScoreUnit } from "../scoring/core";
import {
  averageReviewHours,
  distribution,
  improvementStats,
  moduleAverages,
  skillAverages,
  summariseAiUsage,
  summariseGrading,
} from "./insights";

describe("skillAverages", () => {
  it("averages per area, skips unassessed rows and marks the weakest", () => {
    const s = skillAverages([
      { skill_area_id: 3, percent: 80, assessed: true },
      { skill_area_id: 3, percent: "60", assessed: true },
      { skill_area_id: 6, percent: 40, assessed: true },
      { skill_area_id: 6, percent: 99, assessed: false },
      { skill_area_id: 2, percent: null, assessed: true },
    ]);
    expect(s).toHaveLength(6);
    const by = Object.fromEntries(s.map((x) => [x.skillAreaId, x]));
    expect(by[3].average).toBe(70);
    expect(by[3].samples).toBe(2);
    expect(by[6].average).toBe(40);
    expect(by[6].weakest).toBe(true);
    expect(by[3].weakest).toBe(false);
    expect(by[1].average).toBeNull();
  });

  it("does not mark a weakest area when only one has data", () => {
    const s = skillAverages([{ skill_area_id: 3, percent: 10, assessed: true }]);
    expect(s.some((x) => x.weakest)).toBe(false);
  });
});

describe("moduleAverages", () => {
  const unit = (module: ScoreUnit["module"], earned: number, max: number): ScoreUnit => ({
    taskId: "t",
    aspectId: null,
    skillAreaId: 3,
    module,
    type: "measurement",
    earned,
    max,
    unscored: false,
  });

  it("averages moduleReadiness() output per module and lists all four", () => {
    const a1 = moduleReadiness([unit("M1", 5, 10), unit("M2", 10, 10)]);
    const a2 = moduleReadiness([unit("M1", 9, 10)]);
    const avg = moduleAverages([a1, a2]);
    expect(avg.map((m) => m.module)).toEqual(["M1", "M2", "M3", "M4"]);
    expect(avg[0].attempts).toBe(2);
    expect(avg[0].average).toBe(70); // (50 + 90) / 2
    expect(avg[0].earned).toBe(14);
    expect(avg[0].max).toBe(20);
    expect(avg[1].average).toBe(100);
    expect(avg[2].average).toBeNull();
    expect(avg[2].attempts).toBe(0);
  });
});

describe("improvementStats", () => {
  it("compares first and latest attempt of students with 2+ attempts", () => {
    const s = improvementStats([
      { userId: "a", percent: 40, at: "2026-09-01T00:00:00Z" },
      { userId: "a", percent: 70, at: "2026-10-01T00:00:00Z" },
      { userId: "a", percent: 50, at: "2026-09-15T00:00:00Z" },
      { userId: "b", percent: 60, at: "2026-09-01T00:00:00Z" },
      { userId: "b", percent: 50, at: "2026-10-01T00:00:00Z" },
      { userId: "c", percent: 90, at: "2026-09-01T00:00:00Z" },
    ]);
    expect(s.students).toBe(2);
    expect(s.improved).toBe(1);
    expect(s.averageFirst).toBe(50);
    expect(s.averageLatest).toBe(60);
    expect(s.averageGain).toBe(10);
  });

  it("returns nulls when nobody has two attempts", () => {
    const s = improvementStats([{ userId: "a", percent: 40, at: "2026-09-01T00:00:00Z" }]);
    expect(s.students).toBe(0);
    expect(s.averageGain).toBeNull();
  });
});

describe("distribution", () => {
  it("counts case-insensitively, largest first, and keeps an unknown count", () => {
    const d = distribution(["Qatar University", "qatar university ", "UDST", null, "", "UDST", "UDST"]);
    expect(d.items).toEqual([
      { label: "UDST", count: 3 },
      { label: "Qatar University", count: 2 },
    ]);
    expect(d.unknown).toBe(2);
    expect(d.total).toBe(7);
  });
});

describe("summariseGrading", () => {
  it("counts finished runs, average time and error rates with help slugs", () => {
    const g = summariseGrading([
      { duration_ms: 1000 },
      { duration_ms: "3000" },
      { duration_ms: 500, error_code: "E_NOT_STEP" },
      { duration_ms: null, error_code: "E_NOT_STEP" },
      { duration_ms: null, error: "boom" },
      { duration_ms: 2000, error_code: "E_WHATEVER" },
    ]);
    expect(g.totalRuns).toBe(6);
    expect(g.autoGraded).toBe(2);
    expect(g.failed).toBe(4);
    expect(g.avgDurationMs).toBe(2000);
    expect(g.errors[0]).toEqual({ code: "E_NOT_STEP", count: 2, ratePct: 33.3, helpSlug: "my-file-was-rejected" });
    expect(g.errors.find((e) => e.code === "unknown")?.count).toBe(1);
    expect(g.errors.find((e) => e.code === "E_WHATEVER")?.helpSlug).toBeNull();
  });

  it("handles no runs", () => {
    const g = summariseGrading([]);
    expect(g.avgDurationMs).toBeNull();
    expect(g.errors).toEqual([]);
  });
});

describe("summariseAiUsage", () => {
  it("counts drawing and translation calls and sums the cost", () => {
    const u = summariseAiUsage([
      { kind: "ai_drawing", cost_estimate: 0.012 },
      { kind: "ai_translate", cost_estimate: "0.003" },
      { kind: "step", cost_estimate: 5 },
      { kind: "ai_drawing", cost_estimate: null },
    ]);
    expect(u).toEqual({ checks: 3, drawing: 2, translate: 1, costUsd: 0.015 });
  });
});

describe("averageReviewHours", () => {
  it("averages created to graded in hours", () => {
    const r = averageReviewHours([
      { created_at: "2026-10-01T00:00:00Z", graded_at: "2026-10-01T02:00:00Z" },
      { created_at: "2026-10-01T00:00:00Z", graded_at: "2026-10-01T06:00:00Z" },
      { created_at: "2026-10-01T00:00:00Z", graded_at: null },
    ]);
    expect(r).toEqual({ count: 2, avgHours: 4 });
  });
});
