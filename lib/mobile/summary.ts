// Shaping for the phone dashboard: database rows in, the JSON the app renders
// out. Pure — no Supabase, no Next — so the rule below is unit-tested rather
// than trusted.
//
// The payload is deliberately small. A project's `studio` blob runs to tens of
// kilobytes; the list view sends only what a row shows, and the full record
// goes out only for the one project the app asks for by id.

export type Signal = "committed" | "healthy" | "attention" | "stalled" | "just_started";

/** The rule, in one place. The macOS app implements the same rule; keep them equal. */
export const SIGNAL_RULE = [
  "committed: the customer picked a build route.",
  "attention: a design check failed, or an AI step errored.",
  "stalled: still at the idea stage with no change for 14+ days.",
  "just_started: fewer than 2 chat turns and under a day old.",
  "healthy: none of the above.",
].join("\n");

export type ProjectInput = {
  id: string;
  user_id: string | null;
  name: string | null;
  notes: string | null;
  brief: unknown;
  stage: string | null;
  status: string | null;
  build_route: string | null;
  is_test: boolean | null;
  contact_email: string | null;
  created_at: string | null;
  updated_at: string | null;
  studio: unknown;
};

export type RunInput = {
  id: string;
  project_id: string | null;
  feature: string;
  model: string | null;
  outcome: string;
  error: string | null;
  created_at: string | null;
};

export type SessionInput = { project_id: string; edit_turns: number | null; tier: string | null };
export type ProfileInput = { id: string; full_name: string | null; email: string | null; role: string | null };
export type EventInput = { id: number; project_id: string | null; type: string; created_at: string | null };
export type UsageInput = {
  project_id: string | null;
  outcome: string | null;
  error_code: string | null;
  cost_usd: number | null;
  created_at: string | null;
  is_test: boolean | null;
};
export type InquiryInput = {
  id: string;
  project_id: string | null;
  name: string | null;
  status: string | null;
  final_quote_qar: number | null;
  created_at: string | null;
  is_test: boolean | null;
};

export type Check = { id: string; ok: boolean; text: string };

export type IdeaSummary = {
  id: string;
  name: string;
  writtenIdea: string | null;
  oneLine: string | null;
  stage: string | null;
  status: string | null;
  buildRoute: string | null;
  isTest: boolean;
  owner: string | null;
  signal: Signal;
  reasons: string[];
  checksPassed: number;
  checksFailed: number;
  aiRuns: number;
  aiFailures: number;
  chatTurns: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type IdeaDetail = IdeaSummary & {
  goal: string | null;
  answers: { key: string; value: string }[];
  checks: Check[];
  designs: { id: string; status: string; archetype: string; whyEn: string | null; whyAr: string | null }[];
  components: number;
  has: { spec: boolean; wiring: boolean; enclosure: boolean; firmware: boolean; bom: boolean };
  events: { type: string; at: string | null }[];
  runs: { feature: string; outcome: string; model: string | null; error: string | null; at: string | null }[];
  inquiry: { name: string | null; status: string | null; quoteQar: number | null } | null;
};

export type DayPoint = { day: string; count: number };

export type MobileSummary = {
  generatedAt: string;
  totals: {
    ideas: number;
    needAttention: number;
    committed: number;
    stalled: number;
    people: number;
    inquiries: number;
    quoted: number;
    aiRuns: number;
    aiFailures: number;
    costUsd30d: number;
  };
  series: { newIdeas: DayPoint[]; aiCalls: DayPoint[] };
  ideas: IdeaSummary[];
  problems: { at: string | null; source: string; summary: string; idea: string | null }[];
  signalRule: string;
};

// ── jsonb readers ───────────────────────────────────────────────────────────
// `studio` is written by the Studio and grows new keys over time, so it is read
// key by key: an unexpected shape loses one field instead of failing the route.

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function at(v: unknown, key: string): unknown {
  return obj(v)[key];
}

/** A short single-line rendering of any jsonb leaf, for an answer value. */
function inline(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(inline).filter(Boolean).join(", ");
  const o = obj(v);
  for (const k of ["en", "plain", "text", "label", "name", "title", "oneLine", "goal"]) {
    const s = str(o[k]);
    if (s) return s;
  }
  return Object.keys(o).sort().join(", ");
}

/** What the customer typed, wherever it was stored. */
export function writtenIdea(p: ProjectInput): string | null {
  const brief = p.brief;
  const direct = str(brief);
  if (direct) return direct;
  for (const k of ["text", "idea", "description", "en", "ar"]) {
    const s = str(at(brief, k));
    if (s) return s;
  }
  const notes = str(p.notes);
  if (notes) return notes;
  return str(at(at(p.studio, "answers"), "idea"));
}

export function checksOf(p: ProjectInput): Check[] {
  return arr(at(p.studio, "checks")).map((raw, i) => {
    const c = obj(raw);
    return {
      id: str(c.id) ?? `check_${i}`,
      ok: c.ok === true,
      text: str(c.plain) ?? inline(raw),
    };
  });
}

// ── the rule ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

export function verdict(
  p: ProjectInput,
  runs: RunInput[],
  session: SessionInput | undefined,
  now: Date,
): { signal: Signal; reasons: string[]; checksPassed: number; checksFailed: number; aiFailures: number } {
  const checks = checksOf(p);
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  const aiFailures = runs.filter((r) => r.outcome !== "ok").length;
  const turns = session?.edit_turns ?? 0;

  const updated = p.updated_at ? new Date(p.updated_at) : null;
  const created = p.created_at ? new Date(p.created_at) : null;
  const daysIdle = updated ? Math.floor((now.getTime() - updated.getTime()) / DAY_MS) : 0;
  const ageDays = created ? Math.floor((now.getTime() - created.getTime()) / DAY_MS) : 0;

  const reasons: string[] = [];
  let signal: Signal;

  if (p.build_route) {
    signal = "committed";
    reasons.push(`Build route chosen: ${p.build_route}.`);
  } else if (failed > 0 || aiFailures > 0) {
    signal = "attention";
    if (failed > 0) reasons.push(`${failed} design check${failed === 1 ? "" : "s"} did not pass.`);
    if (aiFailures > 0) reasons.push(`${aiFailures} of ${runs.length} AI step${runs.length === 1 ? "" : "s"} failed.`);
  } else if ((p.stage ?? "idea") === "idea" && daysIdle >= 14) {
    signal = "stalled";
    reasons.push(`Still at the idea stage, untouched for ${daysIdle} days.`);
  } else if (turns < 2 && ageDays < 1) {
    signal = "just_started";
    reasons.push(`Only ${turns} chat turn${turns === 1 ? "" : "s"} so far.`);
  } else {
    signal = "healthy";
    reasons.push("No failed checks and no AI errors.");
  }

  if (passed > 0) reasons.push(`${passed} check${passed === 1 ? "" : "s"} passed.`);
  if (p.is_test) reasons.push("Marked as a test project.");

  return { signal, reasons, checksPassed: passed, checksFailed: failed, aiFailures };
}

// ── series ──────────────────────────────────────────────────────────────────

/** Daily counts over the last `days` days, zero-filled, oldest first. */
export function daily(dates: (string | null)[], now: Date, days = 30): DayPoint[] {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  const buckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const raw of dates) {
    if (!raw) continue;
    const key = raw.slice(0, 10);
    const cur = buckets.get(key);
    if (cur !== undefined) buckets.set(key, cur + 1);
  }
  return [...buckets].map(([day, count]) => ({ day, count }));
}

// ── assembly ────────────────────────────────────────────────────────────────

export type SummaryInput = {
  projects: ProjectInput[];
  runs: RunInput[];
  sessions: SessionInput[];
  profiles: ProfileInput[];
  usage: UsageInput[];
  inquiries: InquiryInput[];
  includeTest: boolean;
  now: Date;
};

function groupRuns(runs: RunInput[]): Map<string, RunInput[]> {
  const out = new Map<string, RunInput[]>();
  for (const r of runs) {
    if (!r.project_id) continue;
    const list = out.get(r.project_id);
    if (list) list.push(r);
    else out.set(r.project_id, [r]);
  }
  return out;
}

export function buildSummary(input: SummaryInput): MobileSummary {
  const { now, includeTest } = input;
  const projects = includeTest ? input.projects : input.projects.filter((p) => p.is_test !== true);
  const runsBy = groupRuns(input.runs);
  const sessionBy = new Map(input.sessions.map((s) => [s.project_id, s]));
  const profileBy = new Map(input.profiles.map((p) => [p.id, p]));

  const ideas: IdeaSummary[] = projects.map((p) => {
    const runs = runsBy.get(p.id) ?? [];
    const session = sessionBy.get(p.id);
    const v = verdict(p, runs, session, now);
    const owner = p.user_id ? profileBy.get(p.user_id) : undefined;
    return {
      id: p.id,
      name: p.name?.trim() || "Untitled idea",
      writtenIdea: writtenIdea(p),
      oneLine: str(at(at(p.studio, "spec"), "oneLine")),
      stage: p.stage,
      status: p.status,
      buildRoute: p.build_route,
      isTest: p.is_test === true,
      owner: owner?.full_name || owner?.email || p.contact_email || null,
      signal: v.signal,
      reasons: v.reasons,
      checksPassed: v.checksPassed,
      checksFailed: v.checksFailed,
      aiRuns: runs.length,
      aiFailures: v.aiFailures,
      chatTurns: session?.edit_turns ?? 0,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });

  ideas.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

  const liveUsage = includeTest ? input.usage : input.usage.filter((u) => u.is_test !== true);
  const cutoff30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();
  const inquiries = includeTest ? input.inquiries : input.inquiries.filter((i) => i.is_test !== true);

  const problems: MobileSummary["problems"] = [];
  const nameById = new Map(ideas.map((i) => [i.id, i.name]));
  for (const r of input.runs) {
    if (r.outcome === "ok") continue;
    problems.push({
      at: r.created_at,
      source: "AI step",
      summary: `${r.feature} · ${r.outcome}${r.model ? ` · ${r.model}` : ""}`,
      idea: r.project_id ? nameById.get(r.project_id) ?? null : null,
    });
  }
  for (const u of liveUsage) {
    if (!u.outcome || u.outcome === "ok") continue;
    problems.push({
      at: u.created_at,
      source: "AI call",
      summary: `${u.outcome}${u.error_code ? ` · ${u.error_code}` : ""}`,
      idea: u.project_id ? nameById.get(u.project_id) ?? null : null,
    });
  }
  problems.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

  return {
    generatedAt: now.toISOString(),
    totals: {
      ideas: ideas.length,
      needAttention: ideas.filter((i) => i.signal === "attention").length,
      committed: ideas.filter((i) => i.signal === "committed").length,
      stalled: ideas.filter((i) => i.signal === "stalled").length,
      people: input.profiles.length,
      inquiries: inquiries.length,
      quoted: inquiries.filter((i) => i.final_quote_qar !== null).length,
      aiRuns: input.runs.length,
      aiFailures: input.runs.filter((r) => r.outcome !== "ok").length,
      costUsd30d: Number(
        liveUsage
          .filter((u) => (u.created_at ?? "") >= cutoff30)
          .reduce((sum, u) => sum + (u.cost_usd ?? 0), 0)
          .toFixed(4),
      ),
    },
    series: {
      newIdeas: daily(projects.map((p) => p.created_at), now),
      aiCalls: daily(liveUsage.map((u) => u.created_at), now),
    },
    ideas,
    problems: problems.slice(0, 60),
    signalRule: SIGNAL_RULE,
  };
}

export type DetailInput = {
  project: ProjectInput;
  runs: RunInput[];
  session: SessionInput | undefined;
  owner: ProfileInput | undefined;
  events: EventInput[];
  inquiry: InquiryInput | undefined;
  now: Date;
};

export function buildDetail(input: DetailInput): IdeaDetail {
  const { project: p, runs, session, owner, events, inquiry, now } = input;
  const v = verdict(p, runs, session, now);
  const studio = p.studio;

  const answers = Object.entries(obj(at(studio, "answers")))
    .filter(([k]) => k !== "idea")
    .map(([key, value]) => ({ key, value: inline(value) }))
    .filter((a) => a.value.length > 0)
    .sort((a, b) => a.key.localeCompare(b.key));

  const designs = arr(at(at(studio, "product"), "designs")).map((raw, i) => {
    const d = obj(raw);
    return {
      id: str(d.id) ?? `design_${i}`,
      status: str(d.status) ?? "unknown",
      archetype: str(d.archetype) ?? "unknown",
      whyEn: str(at(d.why, "en")),
      whyAr: str(at(d.why, "ar")),
    };
  });

  return {
    id: p.id,
    name: p.name?.trim() || "Untitled idea",
    writtenIdea: writtenIdea(p),
    oneLine: str(at(at(studio, "spec"), "oneLine")),
    goal: str(at(at(at(studio, "spec"), "understanding"), "goal")),
    stage: p.stage,
    status: p.status,
    buildRoute: p.build_route,
    isTest: p.is_test === true,
    owner: owner?.full_name || owner?.email || p.contact_email || null,
    signal: v.signal,
    reasons: v.reasons,
    checksPassed: v.checksPassed,
    checksFailed: v.checksFailed,
    aiRuns: runs.length,
    aiFailures: v.aiFailures,
    chatTurns: session?.edit_turns ?? 0,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    answers,
    checks: checksOf(p),
    designs,
    components: arr(at(studio, "components")).length,
    has: {
      spec: Object.keys(obj(at(studio, "spec"))).length > 0,
      wiring: Object.keys(obj(at(studio, "netlist"))).length > 0,
      enclosure: Object.keys(obj(at(studio, "enclosure"))).length > 0,
      firmware: Object.keys(obj(at(studio, "firmware"))).length > 0,
      bom: Object.keys(obj(at(studio, "bom"))).length > 0,
    },
    events: events.map((e) => ({ type: e.type, at: e.created_at })),
    runs: runs.map((r) => ({
      feature: r.feature,
      outcome: r.outcome,
      model: r.model,
      error: r.error,
      at: r.created_at,
    })),
    inquiry: inquiry
      ? { name: inquiry.name, status: inquiry.status, quoteQar: inquiry.final_quote_qar }
      : null,
  };
}
