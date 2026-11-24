// "Champions" — the CAD Champions course: who signed up, who paid, who is
// actually working, and how the tests came out.
//
// Pure: rows in, one Section out.

import {
  breakdown,
  daily,
  delta,
  int,
  inPreviousWindow,
  label,
  money,
  num,
  pct,
  tally,
  toneUp,
  within,
  type Section,
  type Table,
} from "@/lib/mobile/report";

export type CcProfileRow = {
  id: string;
  full_name: string | null;
  institution: string | null;
  study_level: string | null;
  cad_experience: string | null;
  preferred_locale: string | null;
  onboarding_completed_at: string | null;
  last_active_at: string | null;
  created_at: string | null;
};

export type EnrollmentRow = {
  user_id: string | null;
  plan_id: string | null;
  cohort_id: string | null;
  status: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string | null;
};

export type CcPaymentRow = {
  user_id: string | null;
  plan_id: string | null;
  amount_qar: number | string | null;
  discount_qar: number | string | null;
  method: string | null;
  status: string | null;
  created_at: string | null;
  paid_at: string | null;
};

export type AttemptRow = {
  user_id: string | null;
  test_id: string | null;
  status: string | null;
  percent: number | null;
  band: string | null;
  started_at: string | null;
  submitted_at: string | null;
  graded_at: string | null;
};

export type LessonProgressRow = {
  user_id: string | null;
  watched_percent: number | null;
  completed_at: string | null;
  updated_at: string | null;
};

export type XpRow = { user_id: string | null; xp: number | null; streak_weeks: number | null };

export type PlanRow = { id: string; slug: string | null; name_en: string | null; price_qar: number | string | null };

export type CohortRow = {
  id: string;
  name_en: string | null;
  starts_on: string | null;
  seats_total: number | null;
  status: string | null;
};

export type FlagRow = { kind: string | null; resolved_at: string | null; created_at: string | null };

export type ChampionsInput = {
  students: CcProfileRow[];
  enrollments: EnrollmentRow[];
  payments: CcPaymentRow[];
  attempts: AttemptRow[];
  progress: LessonProgressRow[];
  xp: XpRow[];
  plans: PlanRow[];
  cohorts: CohortRow[];
  flags: FlagRow[];
  certificates: { user_id: string | null; issued_at: string | null }[];
  windowDays: number;
  now?: number;
};

export function buildChampions(input: ChampionsInput): Section {
  const now = input.now ?? Date.now();
  const days = input.windowDays;

  const planName = new Map(input.plans.map((p) => [p.id, p.name_en || p.slug || p.id]));

  const signedUpNow = input.students.filter((s) => within(s.created_at, days, now));
  const signedUpBefore = input.students.filter((s) => inPreviousWindow(s.created_at, days, now));
  const activeNow = input.students.filter((s) => within(s.last_active_at, 7, now));
  const finishedOnboarding = input.students.filter((s) => s.onboarding_completed_at);

  const paid = input.payments.filter((p) => p.status === "approved" || p.status === "paid" || p.paid_at);
  const paidNow = paid.filter((p) => within(p.paid_at ?? p.created_at, days, now));
  const paidBefore = paid.filter((p) => inPreviousWindow(p.paid_at ?? p.created_at, days, now));
  const waiting = input.payments.filter((p) => p.status === "pending" || p.status === "submitted" || p.status === "proof_submitted");
  const revenueNow = paidNow.reduce((s, p) => s + num(p.amount_qar), 0);
  const revenueBefore = paidBefore.reduce((s, p) => s + num(p.amount_qar), 0);

  const liveEnrollments = input.enrollments.filter((e) => e.status === "active" || e.status === "enrolled");

  const graded = input.attempts.filter((a) => typeof a.percent === "number" && a.graded_at);
  const avgPercent = graded.length ? graded.reduce((s, a) => s + (a.percent ?? 0), 0) / graded.length : null;
  const passed = graded.filter((a) => (a.percent ?? 0) >= 50);
  const abandoned = input.attempts.filter((a) => a.started_at && !a.submitted_at && !within(a.started_at, 1, now));

  const openFlags = input.flags.filter((f) => !f.resolved_at);

  const seats = input.cohorts.reduce((s, c) => s + (c.seats_total ?? 0), 0);
  const seatsTaken = liveEnrollments.filter((e) => e.cohort_id).length;

  const watchers = input.progress.filter((p) => within(p.updated_at, days, now));
  const completions = input.progress.filter((p) => within(p.completed_at, days, now));

  const topXp = [...input.xp].sort((a, b) => (b.xp ?? 0) - (a.xp ?? 0)).slice(0, 10);
  const nameOf = new Map(input.students.map((s) => [s.id, s.full_name || "—"]));

  const tiles = [
    {
      label: "Students",
      value: int(input.students.length),
      delta: delta(signedUpNow.length, signedUpBefore.length),
      hint: `${int(signedUpNow.length)} new in ${days} days`,
    },
    {
      label: "Active this week",
      value: int(activeNow.length),
      tone: activeNow.length ? ("good" as const) : ("warn" as const),
      hint: input.students.length ? `${pct(activeNow.length, input.students.length)} of students` : undefined,
    },
    { label: "Enrolled", value: int(liveEnrollments.length), hint: "active enrolments" },
    {
      label: "Course revenue (QAR)",
      value: money(revenueNow),
      delta: delta(revenueNow, revenueBefore),
      tone: toneUp(revenueNow, revenueBefore),
      hint: `last ${days} days`,
    },
    {
      label: "Payments waiting",
      value: int(waiting.length),
      tone: waiting.length ? ("warn" as const) : ("good" as const),
    },
    {
      label: "Average test score",
      value: avgPercent === null ? "—" : `${Math.round(avgPercent)}%`,
      hint: `${int(graded.length)} graded attempt${graded.length === 1 ? "" : "s"}`,
    },
    {
      label: "Pass rate",
      value: graded.length ? pct(passed.length, graded.length) : "—",
      tone: graded.length && passed.length / graded.length >= 0.6 ? ("good" as const) : ("warn" as const),
    },
    {
      label: "Integrity flags open",
      value: int(openFlags.length),
      tone: openFlags.length ? ("bad" as const) : ("good" as const),
    },
    {
      label: "Finished onboarding",
      value: input.students.length ? pct(finishedOnboarding.length, input.students.length) : "—",
      hint: `${int(finishedOnboarding.length)} of ${int(input.students.length)}`,
    },
    {
      label: "Seats",
      value: seats ? `${int(seatsTaken)} / ${int(seats)}` : "—",
      hint: "taken of all cohort seats",
    },
    { label: "Certificates", value: int(input.certificates.length), hint: "issued in all" },
    {
      label: "Attempts abandoned",
      value: int(abandoned.length),
      tone: abandoned.length ? ("warn" as const) : ("good" as const),
      hint: "started, never submitted",
    },
  ];

  const tables: Table[] = [
    breakdown("Enrolments by status", tally(input.enrollments, (e) => label(e.status)), ["Status", "Students"]),
    {
      title: "By plan",
      columns: ["Plan", "Paid", "QAR"],
      rows: tally(paid, (p) => (p.plan_id ? planName.get(p.plan_id) ?? p.plan_id : null)).map(([name, n]) => [
        name,
        int(n),
        money(paid.filter((p) => p.plan_id && (planName.get(p.plan_id) ?? p.plan_id) === name).reduce((s, p) => s + num(p.amount_qar), 0)),
      ]),
      align: ["l", "r", "r"],
      empty: "Nothing paid yet.",
    },
    {
      title: "Cohorts",
      columns: ["Cohort", "Starts", "Seats", "Status"],
      rows: [...input.cohorts]
        .sort((a, b) => (b.starts_on ?? "").localeCompare(a.starts_on ?? ""))
        .slice(0, 10)
        .map((c) => [
          c.name_en ?? c.id,
          c.starts_on ?? "—",
          `${int(liveEnrollments.filter((e) => e.cohort_id === c.id).length)} / ${int(c.seats_total ?? 0)}`,
          label(c.status),
        ]),
      align: ["l", "l", "r", "l"],
      empty: "No cohorts set up.",
    },
    breakdown("Test result bands", tally(graded, (a) => label(a.band)), ["Band", "Attempts"]),
    {
      title: "Furthest along",
      columns: ["Student", "XP", "Streak"],
      rows: topXp.map((x) => [
        (x.user_id && nameOf.get(x.user_id)) || "—",
        int(x.xp ?? 0),
        `${int(x.streak_weeks ?? 0)} wk`,
      ]),
      align: ["l", "r", "r"],
      empty: "No XP recorded.",
    },
    breakdown("Where they study", tally(input.students, (s) => s.institution).slice(0, 12), ["Institution", "Students"], "No institution given."),
    breakdown("CAD experience", tally(input.students, (s) => label(s.cad_experience)), ["Experience", "Students"]),
    breakdown("Open integrity flags", tally(openFlags, (f) => label(f.kind)), ["Kind", "Flags"], "None open."),
  ];

  const notes = championsNotes({
    waiting: waiting.length,
    openFlags: openFlags.length,
    abandoned: abandoned.length,
    students: input.students.length,
    active: activeNow.length,
    completions: completions.length,
    workers: new Set(watchers.map((w) => w.user_id)).size,
  });

  return {
    key: "champions",
    title: "Champions",
    symbol: "graduationcap",
    blurb: "The CAD Champions course: sign-ups, payments, work done, test results.",
    tiles,
    series: [
      { title: "Sign-ups a day", kind: "bar", points: daily(signedUpNow.map((s) => ({ at: s.created_at })), days, now) },
      {
        title: "Course revenue a day",
        kind: "bar",
        unit: "QAR",
        points: daily(paidNow.map((p) => ({ at: p.paid_at ?? p.created_at, weight: num(p.amount_qar) })), days, now),
      },
      { title: "Lessons finished a day", kind: "bar", points: daily(completions.map((p) => ({ at: p.completed_at })), days, now) },
      { title: "Test attempts a day", kind: "bar", points: daily(input.attempts.filter((a) => within(a.started_at, days, now)).map((a) => ({ at: a.started_at })), days, now) },
    ],
    tables,
    notes,
  };
}

/** What stands out, in plain words. Split out to keep buildChampions simple. */
function championsNotes(n: {
  waiting: number;
  openFlags: number;
  abandoned: number;
  students: number;
  active: number;
  completions: number;
  workers: number;
}): string[] {
  const notes: string[] = [];
  if (n.waiting) notes.push(`${n.waiting} course payment${n.waiting === 1 ? "" : "s"} waiting to be reviewed.`);
  if (n.openFlags) notes.push(`${n.openFlags} integrity flag${n.openFlags === 1 ? "" : "s"} still open.`);
  if (n.abandoned) notes.push(`${n.abandoned} test attempt${n.abandoned === 1 ? " was" : "s were"} started and never submitted.`);
  if (n.students && n.active / n.students < 0.2) notes.push(`Only ${pct(n.active, n.students)} of students were active in the last week.`);
  if (n.completions) notes.push(`${n.completions} lesson${n.completions === 1 ? "" : "s"} finished in this window, by ${n.workers} student(s).`);
  if (!notes.length) notes.push("The course is running clean: no payments or flags waiting.");
  return notes;
}
