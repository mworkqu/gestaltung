import { describe, expect, it } from "vitest";

import {
  buildDetail,
  buildSummary,
  checksOf,
  daily,
  verdict,
  writtenIdea,
  type ProjectInput,
  type RunInput,
} from "@/lib/mobile/summary";

const NOW = new Date("2026-11-22T00:00:00.000Z");

function project(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: null,
    name: "Plant waterer",
    notes: null,
    brief: null,
    stage: "idea",
    status: "active",
    build_route: null,
    is_test: null,
    contact_email: null,
    created_at: "2026-11-21T10:00:00.000Z",
    updated_at: "2026-11-21T12:00:00.000Z",
    studio: null,
    ...over,
  };
}

function run(over: Partial<RunInput> = {}): RunInput {
  return {
    id: "r1",
    project_id: "11111111-1111-4111-8111-111111111111",
    feature: "studio",
    model: "gemini-3.5-flash-lite",
    outcome: "ok",
    error: null,
    created_at: "2026-11-21T11:00:00.000Z",
    ...over,
  };
}

describe("writtenIdea", () => {
  it("prefers brief as a plain string", () => {
    expect(writtenIdea(project({ brief: "turn walking into power" }))).toBe("turn walking into power");
  });

  it("reads brief objects, then notes, then the studio answer", () => {
    expect(writtenIdea(project({ brief: { text: "from an object" } }))).toBe("from an object");
    expect(writtenIdea(project({ brief: null, notes: "from notes" }))).toBe("from notes");
    expect(writtenIdea(project({ studio: { answers: { idea: "from studio" } } }))).toBe("from studio");
  });

  it("is null when nothing was written", () => {
    expect(writtenIdea(project())).toBeNull();
  });

  it("survives a studio blob of an unexpected shape", () => {
    expect(writtenIdea(project({ brief: 42, studio: "not an object" }))).toBeNull();
  });
});

describe("checksOf", () => {
  it("reads id, ok and the plain sentence", () => {
    const checks = checksOf(
      project({ studio: { checks: [{ id: "ok_usb", ok: true, plain: "Runs safely from USB." }] } }),
    );
    expect(checks).toEqual([{ id: "ok_usb", ok: true, text: "Runs safely from USB." }]);
  });

  it("treats a missing ok as not passed", () => {
    expect(checksOf(project({ studio: { checks: [{ id: "x", plain: "hm" }] } }))[0]!.ok).toBe(false);
  });

  it("returns nothing when there are no checks", () => {
    expect(checksOf(project())).toEqual([]);
  });
});

describe("verdict", () => {
  it("is committed once a build route is chosen, even with failed checks", () => {
    const p = project({ build_route: "prototype", studio: { checks: [{ id: "a", ok: false, plain: "no" }] } });
    expect(verdict(p, [], undefined, NOW).signal).toBe("committed");
  });

  it("needs attention when a check failed", () => {
    const p = project({ studio: { checks: [{ id: "a", ok: false, plain: "added a resistor" }] } });
    const v = verdict(p, [], { project_id: p.id, edit_turns: 5, tier: "maker" }, NOW);
    expect(v.signal).toBe("attention");
    expect(v.checksFailed).toBe(1);
    expect(v.reasons[0]).toContain("1 design check");
  });

  it("needs attention when an AI step errored", () => {
    const v = verdict(project(), [run({ outcome: "error" })], undefined, NOW);
    expect(v.signal).toBe("attention");
    expect(v.aiFailures).toBe(1);
  });

  it("is stalled at the idea stage after 14 idle days", () => {
    const p = project({ updated_at: "2026-11-01T00:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z" });
    expect(verdict(p, [], { project_id: p.id, edit_turns: 4, tier: "maker" }, NOW).signal).toBe("stalled");
  });

  it("is not stalled once it moved past the idea stage", () => {
    const p = project({ stage: "bom", updated_at: "2026-11-01T00:00:00.000Z" });
    expect(verdict(p, [], { project_id: p.id, edit_turns: 4, tier: "maker" }, NOW).signal).toBe("healthy");
  });

  it("is just started for a fresh project with barely any chat", () => {
    const p = project({ created_at: "2026-11-21T23:00:00.000Z", updated_at: "2026-11-21T23:30:00.000Z" });
    expect(verdict(p, [], { project_id: p.id, edit_turns: 1, tier: "explorer" }, NOW).signal).toBe("just_started");
  });

  it("is healthy when checks pass and nothing failed", () => {
    const p = project({ studio: { checks: [{ id: "a", ok: true, plain: "fine" }] } });
    const v = verdict(p, [run()], { project_id: p.id, edit_turns: 6, tier: "maker" }, NOW);
    expect(v.signal).toBe("healthy");
    expect(v.checksPassed).toBe(1);
  });
});

describe("daily", () => {
  it("zero-fills the window and counts into the right day", () => {
    const points = daily(["2026-11-22T05:00:00.000Z", "2026-11-22T09:00:00.000Z", "2026-11-20T01:00:00.000Z"], NOW, 3);
    expect(points).toEqual([
      { day: "2026-11-20", count: 1 },
      { day: "2026-11-21", count: 0 },
      { day: "2026-11-22", count: 2 },
    ]);
  });

  it("ignores nulls and dates outside the window", () => {
    expect(daily([null, "2020-01-01T00:00:00.000Z"], NOW, 2).every((p) => p.count === 0)).toBe(true);
  });
});

describe("buildSummary", () => {
  const base = {
    runs: [] as RunInput[],
    sessions: [],
    profiles: [{ id: "u1", full_name: "Mohmmad", email: "owner@example.com", role: "super_admin" }],
    usage: [],
    inquiries: [],
    now: NOW,
  };

  it("hides test projects unless asked for them", () => {
    const projects = [project({ id: "a", is_test: true }), project({ id: "b" })];
    expect(buildSummary({ ...base, projects, includeTest: false }).ideas.map((i) => i.id)).toEqual(["b"]);
    expect(buildSummary({ ...base, projects, includeTest: true }).ideas).toHaveLength(2);
  });

  it("counts the signals and names the owner", () => {
    const projects = [
      project({ id: "a", user_id: "u1", build_route: "prototype" }),
      project({ id: "b", studio: { checks: [{ id: "c", ok: false, plain: "no" }] } }),
    ];
    const out = buildSummary({ ...base, projects, includeTest: false });
    expect(out.totals.committed).toBe(1);
    expect(out.totals.needAttention).toBe(1);
    expect(out.ideas.find((i) => i.id === "a")!.owner).toBe("Mohmmad");
  });

  it("sums only the last 30 days of AI cost, and skips test usage", () => {
    const out = buildSummary({
      ...base,
      projects: [project()],
      includeTest: false,
      usage: [
        { project_id: null, outcome: "ok", error_code: null, cost_usd: 0.5, created_at: "2026-11-21T00:00:00.000Z", is_test: false },
        { project_id: null, outcome: "ok", error_code: null, cost_usd: 9, created_at: "2026-01-01T00:00:00.000Z", is_test: false },
        { project_id: null, outcome: "ok", error_code: null, cost_usd: 7, created_at: "2026-11-21T00:00:00.000Z", is_test: true },
      ],
    });
    expect(out.totals.costUsd30d).toBe(0.5);
  });

  it("lists failures newest first", () => {
    const out = buildSummary({
      ...base,
      projects: [project({ id: "11111111-1111-4111-8111-111111111111" })],
      includeTest: false,
      runs: [
        run({ id: "old", outcome: "error", created_at: "2026-11-01T00:00:00.000Z" }),
        run({ id: "new", outcome: "invalid", created_at: "2026-11-20T00:00:00.000Z" }),
      ],
    });
    expect(out.problems.map((p) => p.summary[0])).toBeTruthy();
    expect(out.problems[0]!.at).toBe("2026-11-20T00:00:00.000Z");
    expect(out.problems[0]!.idea).toBe("Plant waterer");
  });
});

describe("buildDetail", () => {
  it("pulls out answers, designs and what was produced", () => {
    const p = project({
      studio: {
        answers: { idea: "skip me", product_finish: "matte_plastic", a0: { en: "a sensor pod" } },
        checks: [{ id: "ok", ok: true, plain: "fine" }],
        components: [{}, {}],
        spec: { oneLine: "waters one pot", understanding: { goal: "keep a plant alive" } },
        netlist: { nets: [] },
        product: { designs: [{ id: "d1", status: "ready", archetype: "stake_device", why: { en: "neat", ar: "جميل" } }] },
      },
    });
    const d = buildDetail({ project: p, runs: [run()], session: undefined, owner: undefined, events: [], inquiry: undefined, now: NOW });

    expect(d.answers.map((a) => a.key)).toEqual(["a0", "product_finish"]);
    expect(d.answers[0]!.value).toBe("a sensor pod");
    expect(d.goal).toBe("keep a plant alive");
    expect(d.oneLine).toBe("waters one pot");
    expect(d.components).toBe(2);
    expect(d.has).toMatchObject({ spec: true, wiring: true, enclosure: false, firmware: false });
    expect(d.designs[0]).toMatchObject({ archetype: "stake_device", whyAr: "جميل" });
  });

  it("returns an empty but valid detail for a bare project", () => {
    const d = buildDetail({ project: project(), runs: [], session: undefined, owner: undefined, events: [], inquiry: undefined, now: NOW });
    expect(d.answers).toEqual([]);
    expect(d.checks).toEqual([]);
    expect(d.designs).toEqual([]);
    expect(d.inquiry).toBeNull();
  });
});
