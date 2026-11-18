// TEST-ONLY sample data for the CAD Champions e2e fixtures (see page.tsx).
// Nothing here is real: fixed ids, sample names, no database rows. The specs in
// e2e/cad-champions/*.spec.ts import the same ids, so keep them in sync.

import type { Locale } from "@/i18n/routing";
import type { AdminPaymentCardData } from "@/components/cad-champions/payments/admin-payment-card";
import type { CheckoutCohort, CheckoutPlan } from "@/components/cad-champions/payments/checkout-client";
import type { FawranPayProps } from "@/components/cad-champions/payments/fawran-pay";
import type { CcTest } from "@/lib/cad-champions/db/types";
import type { ReviewItemView } from "@/lib/cad-champions/drawing/review-server";
import { OFFICIAL_WEIGHTS, SKILL_AREA_IDS } from "@/lib/cad-champions/scoring/config";
import { bandFor, levelFor, overallPercent, recommendTrainingPath } from "@/lib/cad-champions/scoring/core";
import type { ResultsView } from "@/lib/cad-champions/scoring/load";
import type { TaskView } from "@/lib/cad-champions/test/view";

/** Fixture names: /cad-champions/{en,ar}/e2e-fixtures/<name>. */
export const FIXTURES = [
  "dashboard",
  "onboarding",
  "get-ready",
  "test-intro",
  "workspace",
  "submitted",
  "results",
  "lesson",
  "exercise",
  "checkout",
  "fawran",
  "review",
  "payments",
] as const;

export const FX = {
  userId: "00000000-0000-4000-8000-0000000000e2",
  testId: "00000000-0000-4000-8000-000000000a01",
  attemptId: "00000000-0000-4000-8000-000000000b01",
  task1: "00000000-0000-4000-8000-000000000c01",
  task2: "00000000-0000-4000-8000-000000000c02",
  paymentId: "00000000-0000-4000-8000-000000000d01",
  planId: "00000000-0000-4000-8000-000000000f01",
  cohortId: "00000000-0000-4000-8000-000000000f11",
  reviewId: "00000000-0000-4000-8000-000000000e01",
  exerciseId: "00000000-0000-4000-8000-000000000e11",
  slug: "e2e-sample-test",
} as const;

/** module_package expectations: task 1 = Part_01, task 2 = Part_02 (STEP required). */
export const PACKAGE_EXPECTATIONS = {
  tasks: {
    [FX.task1]: { files: ["Parts and Assemblies/Part_01.*"], require_step: true },
    [FX.task2]: { files: ["Parts and Assemblies/Part_02.*"], require_step: true },
  },
};

export function sampleTest(uploadMode: "per_task" | "module_package" = "module_package"): CcTest {
  return {
    id: FX.testId,
    slug: FX.slug,
    title_en: "Sample diagnostic test",
    title_ar: "Sample diagnostic test (AR)",
    type: "diagnostic",
    time_limit_minutes: 90,
    grace_seconds: 120,
    is_published: true,
    admin_only: false,
    intro_en: "A short sample test used by the automated checks.",
    intro_ar: null,
    rules_en: null,
    rules_ar: null,
    retake_cooldown_days: 30,
    upload_mode: uploadMode,
    package_expectations: PACKAGE_EXPECTATIONS,
    created_by: null,
    created_at: "2026-09-01T08:00:00Z",
    updated_at: "2026-09-01T08:00:00Z",
  };
}

export function sampleTasks(uploadMode: "per_task" | "module_package" = "module_package"): TaskView[] {
  const pkg = uploadMode === "module_package";
  return [
    {
      id: FX.task1,
      position: 1,
      number: 1,
      title: "Bracket",
      skillAreaId: 3,
      skillName: "3D modelling",
      moduleCode: "M3",
      moduleName: "Assemblies and detail drawing",
      points: 40,
      expectedUpload: "step",
      gradingMode: "auto_step",
      density: 7850,
      material: "Steel",
      attachments: [],
      expectedFiles: pkg ? ["Parts and Assemblies/Part_01.*"] : [],
    },
    {
      id: FX.task2,
      position: 2,
      number: 2,
      title: "Shaft",
      skillAreaId: 3,
      skillName: "3D modelling",
      moduleCode: "M3",
      moduleName: "Assemblies and detail drawing",
      points: 60,
      expectedUpload: "step",
      gradingMode: "auto_step",
      density: 2700,
      material: "Aluminium",
      attachments: [],
      expectedFiles: pkg ? ["Parts and Assemblies/Part_02.*"] : [],
    },
  ];
}

/** ?variant= on the results fixture. */
export const RESULT_VARIANTS = ["weak", "medium", "strong", "provisional", "expired"] as const;
export type ResultVariant = (typeof RESULT_VARIANTS)[number];

const VARIANT_PERCENTS: Record<ResultVariant, Record<number, number | null>> = {
  weak: { 1: null, 2: 20, 3: 15, 4: null, 5: null, 6: 10 },
  medium: { 1: null, 2: 80, 3: 55, 4: null, 5: null, 6: 40 },
  strong: { 1: null, 2: 96, 3: 92, 4: null, 5: null, 6: 88 },
  provisional: { 1: null, 2: 80, 3: 55, 4: null, 5: null, 6: 40 },
  expired: { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null },
};

/** Results with real scoring helpers on sample percents (areas 2, 3, 6 assessed). */
export function sampleResults(locale: Locale, areaNames: Record<number, string>, variant: ResultVariant = "medium"): ResultsView {
  const percents = VARIANT_PERCENTS[variant];
  const scored = SKILL_AREA_IDS.map((id) => ({
    skillAreaId: id,
    weight: OFFICIAL_WEIGHTS[id],
    percent: percents[id],
    assessed: percents[id] != null,
  }));
  const overall = overallPercent(scored).percent ?? 0;
  return {
    attemptId: FX.attemptId,
    userId: FX.userId,
    status: variant === "expired" ? "expired" : variant === "provisional" ? "provisional" : "graded",
    outcome: variant === "provisional" ? "provisional" : "graded",
    startedAt: "2026-09-10T06:00:00Z",
    submittedAt: "2026-09-10T07:20:00Z",
    submitReason: "manual",
    percent: overall,
    band: bandFor(overall),
    shareEnabled: false,
    shareToken: null,
    timeUsedMinutes: 80,
    timeAllowedMinutes: 90,
    retakeAt: variant === "expired" ? Date.parse("2030-01-15T09:00:00Z") : null,
    test: { id: FX.testId, slug: FX.slug, title: locale === "ar" ? "Sample diagnostic test (AR)" : "Sample diagnostic test", titleEn: "Sample diagnostic test", titleAr: "Sample diagnostic test (AR)", type: "diagnostic" },
    studentName: "Sample Student",
    areas: scored.map((a) => ({
      id: a.skillAreaId,
      name: areaNames[a.skillAreaId] ?? String(a.skillAreaId),
      weight: a.weight,
      percent: a.percent,
      level: a.percent == null ? null : levelFor(a.percent),
      assessed: a.assessed,
    })),
    modules: [{ code: "M3", name: "Assemblies and detail drawing", percent: percents[3] ?? 0, level: levelFor(percents[3] ?? 0) }],
    tasks: [
      {
        id: FX.task1,
        number: 1,
        title: "Bracket",
        skillAreaId: 3,
        skillName: "3D modelling",
        moduleCode: "M3",
        moduleName: "Assemblies and detail drawing",
        earned: 40,
        max: 40,
        method: "auto",
        status: "graded",
        hasFile: true,
        checking: false,
        waitingTrainer: false,
        manualCheck: false,
        feedback: null,
        reviewerComment: null,
        failed: [],
        judgements: [],
        checklistPending: false,
        checklist: null,
        commentMachineTranslated: false,
        question: null,
        error: null,
        taskResultId: null,
        queryOpen: false,
      },
      {
        id: FX.task2,
        number: 2,
        title: "Shaft",
        skillAreaId: 3,
        skillName: "3D modelling",
        moduleCode: "M3",
        moduleName: "Assemblies and detail drawing",
        earned: 15,
        max: 60,
        method: "trainer",
        status: "graded",
        hasFile: true,
        checking: false,
        waitingTrainer: false,
        manualCheck: false,
        feedback: null,
        reviewerComment: "Check the shaft length against the drawing.",
        failed: [{ description: "Part volume within 0.5%", hint: "Compare your length with the drawing." }],
        judgements: [{ description: "Model is clean and well organised", score: 2 }],
        checklistPending: false,
        checklist: null,
        commentMachineTranslated: false,
        question: null,
        error: null,
        taskResultId: null,
        queryOpen: false,
      },
    ],
    path: recommendTrainingPath(scored),
    anyManualCheck: variant === "provisional",
  };
}

/** ?state= on the dashboard fixture: a student at each point of the journey. */
export const DASHBOARD_STATES = {
  new: { journey: null, profile: { full_name: "Sample Student", phone: null, date_of_birth: null }, attempt: null },
  ready: {
    journey: { profile_completed_at: "2026-09-01T08:00:00Z", get_ready_completed_at: "2026-09-02T08:00:00Z", practice_passed_at: "2026-09-02T08:30:00Z" },
    profile: { full_name: "Sample Student", phone: "+97455555555", date_of_birth: "2008-05-01" },
    attempt: null,
  },
  testing: {
    journey: { profile_completed_at: "2026-09-01T08:00:00Z", get_ready_completed_at: "2026-09-02T08:00:00Z", practice_passed_at: "2026-09-02T08:30:00Z" },
    profile: { full_name: "Sample Student", phone: "+97455555555", date_of_birth: "2008-05-01" },
    attempt: { status: "in_progress" },
  },
  results: {
    journey: {
      profile_completed_at: "2026-09-01T08:00:00Z",
      get_ready_completed_at: "2026-09-02T08:00:00Z",
      practice_passed_at: "2026-09-02T08:30:00Z",
      first_test_submitted_at: "2026-09-10T07:20:00Z",
    },
    profile: { full_name: "Sample Student", phone: "+97455555555", date_of_birth: "2008-05-01" },
    attempt: { status: "graded", submitted_at: "2026-09-10T07:20:00Z" },
  },
  enrolled: {
    journey: {
      profile_completed_at: "2026-09-01T08:00:00Z",
      get_ready_completed_at: "2026-09-02T08:00:00Z",
      practice_passed_at: "2026-09-02T08:30:00Z",
      first_test_submitted_at: "2026-09-10T07:20:00Z",
      results_viewed_at: "2026-09-11T07:00:00Z",
      sample_lesson_watched_at: "2026-09-12T07:00:00Z",
      enrolled_at: "2026-09-20T07:00:00Z",
    },
    profile: { full_name: "Sample Student", phone: "+97455555555", date_of_birth: "2008-05-01" },
    attempt: { status: "graded", submitted_at: "2026-09-10T07:20:00Z" },
  },
} as const;
export type DashboardState = keyof typeof DASHBOARD_STATES;

/** Get Ready keys with every required step done except the practice upload (?keys=practice). */
export const GET_READY_ALMOST_DONE = [
  "welcome_video",
  "check_computer",
  "install_software",
  "essential_actions",
  ...["units_mm", "material_density", "export_step", "export_pdf", "find_upload"].map((k) => `essential_actions__${k}`),
  "test_day_checklist",
  ...["time_90", "charged", "close_apps", "cad_ready", "know_exports", "upload_each", "work_alone"].map((k) => `test_day_checklist__${k}`),
];

export const SAMPLE_PLANS: CheckoutPlan[] = [
  {
    id: FX.planId,
    slug: "e2e-online",
    name: "Online training (sample)",
    whoFor: "Students who train from home",
    includes: ["All lessons", "Graded exercises"],
    priceQar: 500,
    durationDays: 90,
    needsCohort: true,
    featured: true,
    purchasable: true,
  },
];

export const SAMPLE_COHORTS: CheckoutCohort[] = [
  { id: FX.cohortId, name: "Sample cohort A", dates: "1-30 Nov 2026", location: "Doha", seatsLeft: 5, availability: "open" },
];

export function sampleFawran(): FawranPayProps {
  return {
    paymentId: FX.paymentId,
    userId: FX.userId,
    status: "awaiting_transfer",
    amount: "QAR 450",
    referenceCode: "CC-E2E-0001",
    expiresAt: "16 Oct 2026",
    rejectReason: null,
    details: { alias: "sample-alias", mobile: null, iban: "QA00SAMP000000000000000000000", accountName: "Sample Account", bankName: "Sample Bank" },
  };
}

export const SAMPLE_PAYMENT_CARD: AdminPaymentCardData = {
  id: FX.paymentId,
  status: "proof_submitted",
  statusLabel: "Proof sent",
  tone: "warning",
  studentName: "Sample Student",
  studentEmail: "student@example.invalid",
  studentPhone: null,
  plan: "Online training (sample)",
  cohort: "Sample cohort A",
  amount: "QAR 450",
  referenceCode: "CC-E2E-0001",
  payerName: "Sample Payer",
  payerBank: "Sample Bank",
  transferReference: "TRX-0001",
  transferredAt: "14 Oct 2026, 10:00",
  created: "14 Oct 2026, 09:00",
  expires: null,
  rejectReason: null,
  proofUrl: null,
  proofIsPdf: false,
};

/** A drawing review with one measurement item and one judgement item (max 6 points). */
export const SAMPLE_REVIEW: ReviewItemView = {
  id: FX.reviewId,
  status: "needs_review",
  finalized: false,
  attemptId: FX.attemptId,
  studentName: "Sample Student",
  testTitle: "Sample diagnostic test",
  taskTitle: "Bracket drawing",
  taskBrief: "Make a detail drawing of the bracket.",
  gradingMode: "ai_drawing",
  submittedAt: "2026-10-14T06:00:00Z",
  waitingHours: 3,
  aspects: [
    {
      id: "00000000-0000-4000-8000-000000000a11",
      type: "measurement",
      method: "trainer",
      maxPoints: 4,
      description: "Projection symbol present",
      hint: null,
      ai: null,
      existing: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000a12",
      type: "judgement",
      method: "trainer",
      maxPoints: 6,
      description: "Drawing layout and presentation",
      hint: null,
      ai: null,
      existing: null,
    },
  ],
  summary: null,
  aiSkipped: null,
  aiModel: null,
  comment: { en: "", ar: "", machine: null },
  pdfUrl: null,
  upload: null,
  packageFiles: [],
  unmatchedFiles: [],
  nextId: null,
  total: 1,
  position: 1,
};
