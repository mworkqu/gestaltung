// Admin student detail — SERVER ONLY (service role). The CALLER checks the
// role first (requireCcStaff). One student's profile, journey, attempts,
// exercises, payments, enrollments, questions, integrity flags, trainer
// notes and level unlocks, plus the course tree (for "unlock level") and the
// module_package tests (for a one-student in-person start). Every part
// degrades to an empty list when its table is missing.

import type {
  CcBand,
  CcEnrollment,
  CcIntegrityFlag,
  CcJourneyProgress,
  CcLessonQuestion,
  CcPayment,
  CcProfile,
} from "../db/types";
import { isInPersonEligible, type InPersonTestRow } from "./in-person";
import type { AdminDb } from "./server";
import { isMissingSchema } from "./server";
import { isUuid, summariseExercises, type ExerciseSummary } from "./student-detail";
import { verificationState, type VerificationState } from "./student-actions";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/student-detail-server.ts is server-only");

export interface DetailAttempt {
  id: string;
  testId: string;
  testTitleEn: string | null;
  testTitleAr: string | null;
  status: string;
  percent: number | null;
  band: CcBand | null;
  inPerson: boolean;
  sessionId: string | null;
  startedAt: string;
  submittedAt: string | null;
}

export interface DetailExercise extends ExerciseSummary {
  titleEn: string | null;
  titleAr: string | null;
}

export interface DetailNote {
  id: string;
  body: string;
  createdAt: string;
  authorName: string | null;
}

export interface DetailLevel {
  id: string;
  label: { en: string; ar: string };
  unlocked: boolean;
}

export interface StudentDetail {
  profile: CcProfile;
  journey: Partial<CcJourneyProgress> | null;
  steps: { step_key: string; completed_at: string }[];
  attempts: DetailAttempt[];
  exercises: DetailExercise[];
  payments: (Pick<CcPayment, "id" | "status" | "amount_qar" | "reference_code" | "method" | "created_at" | "paid_at"> & { planEn: string | null; planAr: string | null })[];
  enrollments: Pick<CcEnrollment, "id" | "source" | "status" | "starts_at" | "ends_at" | "plan_id">[];
  questions: Pick<CcLessonQuestion, "id" | "kind" | "body" | "status" | "answer" | "created_at" | "answered_at">[];
  flags: Pick<CcIntegrityFlag, "id" | "attempt_id" | "kind" | "details" | "resolved_at" | "resolved_by" | "created_at">[];
  notes: DetailNote[];
  levels: DetailLevel[];
  inPersonTests: Pick<InPersonTestRow, "id" | "slug" | "title_en" | "title_ar">[];
  verification: VerificationState | "unknown";
}

export type StudentDetailLoad = { ok: true; detail: StudentDetail } | { ok: false; reason: "not_found" | "not_set_up" | "error" };

type Res<T> = { data: T[] | null; error: { code?: string } | null };
const rows = <T>(r: Res<T>): T[] => (r.error ? [] : (r.data ?? []));

export async function loadStudentDetail(db: AdminDb, studentId: string): Promise<StudentDetailLoad> {
  if (!isUuid(studentId)) return { ok: false, reason: "not_found" };
  try {
    const { data: profile, error } = await db.from("cc_profiles").select("*").eq("id", studentId).maybeSingle<CcProfile>();
    if (error) return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
    if (!profile) return { ok: false, reason: "not_found" };

    const [journey, steps, attempts, exAttempts, payments, enrollments, questions, flags, notes, unlocks, courses, modules, levels, tests] = await Promise.all([
      db.from("cc_journey_progress").select("*").eq("user_id", studentId).maybeSingle<CcJourneyProgress>(),
      db.from("cc_get_ready_steps").select("step_key,completed_at").eq("user_id", studentId),
      db
        .from("cc_attempts")
        .select("id,test_id,status,percent,band,in_person,session_id,started_at,submitted_at")
        .eq("user_id", studentId)
        .order("started_at", { ascending: false })
        .limit(200),
      db.from("cc_exercise_attempts").select("exercise_id,status,percent,passed,created_at").eq("user_id", studentId).order("created_at", { ascending: false }).limit(1000),
      db
        .from("cc_payments")
        .select("id,status,amount_qar,reference_code,method,created_at,paid_at,plan_id")
        .eq("user_id", studentId)
        .order("created_at", { ascending: false })
        .limit(100),
      db.from("cc_enrollments").select("id,source,status,starts_at,ends_at,plan_id").eq("user_id", studentId).order("ends_at", { ascending: false }).limit(100),
      db
        .from("cc_lesson_questions")
        .select("id,kind,body,status,answer,created_at,answered_at")
        .eq("user_id", studentId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("cc_integrity_flags")
        .select("id,attempt_id,kind,details,resolved_at,resolved_by,created_at")
        .eq("user_id", studentId)
        .order("created_at", { ascending: false })
        .limit(200),
      db.from("cc_student_notes").select("id,author_id,body,created_at").eq("student_id", studentId).order("created_at", { ascending: false }).limit(200),
      db.from("cc_level_unlocks").select("level_id").eq("user_id", studentId),
      db.from("cc_courses").select("id,title_en,title_ar,sort").order("sort"),
      db.from("cc_modules").select("id,course_id,title_en,title_ar,sort").order("sort"),
      db.from("cc_levels").select("id,module_id,level_number,title_en,title_ar").order("level_number"),
      db.from("cc_tests").select("id,slug,title_en,title_ar,type,upload_mode,is_published,admin_only").eq("upload_mode", "module_package").order("slug"),
    ]);

    // Names for tests, exercises, plans and note authors.
    const attemptRows = rows(attempts as Res<{ id: string; test_id: string; status: string; percent: number | null; band: CcBand | null; in_person: boolean; session_id: string | null; started_at: string; submitted_at: string | null }>);
    const exRows = rows(exAttempts as Res<{ exercise_id: string; status: string; percent: number | null; passed: boolean | null; created_at: string }>);
    const payRows = rows(payments as Res<StudentDetail["payments"][number] & { plan_id: string }>);
    const noteRows = rows(notes as Res<{ id: string; author_id: string | null; body: string; created_at: string }>);

    const testIds = [...new Set(attemptRows.map((a) => a.test_id))];
    const exIds = [...new Set(exRows.map((e) => e.exercise_id))];
    const planIds = [...new Set(payRows.map((p) => p.plan_id).filter(Boolean))];
    const authorIds = [...new Set(noteRows.map((n) => n.author_id).filter((x): x is string => !!x))];
    const [testNames, exNames, planNames, authors] = await Promise.all([
      testIds.length ? db.from("cc_tests").select("id,title_en,title_ar").in("id", testIds) : Promise.resolve({ data: [], error: null }),
      exIds.length ? db.from("cc_exercises").select("id,title_en,title_ar").in("id", exIds) : Promise.resolve({ data: [], error: null }),
      planIds.length ? db.from("cc_plans").select("id,name_en,name_ar").in("id", planIds) : Promise.resolve({ data: [], error: null }),
      authorIds.length ? db.from("cc_profiles").select("id,full_name,email").in("id", authorIds) : Promise.resolve({ data: [], error: null }),
    ]);
    const tName = new Map(rows(testNames as Res<{ id: string; title_en: string; title_ar: string }>).map((t) => [t.id, t]));
    const eName = new Map(rows(exNames as Res<{ id: string; title_en: string; title_ar: string }>).map((t) => [t.id, t]));
    const pName = new Map(rows(planNames as Res<{ id: string; name_en: string; name_ar: string }>).map((t) => [t.id, t]));
    const aName = new Map(rows(authors as Res<{ id: string; full_name: string | null; email: string | null }>).map((t) => [t.id, t.full_name || t.email]));

    // Course tree -> level options "Course › Module › Level N: title".
    const unlocked = new Set(rows(unlocks as Res<{ level_id: string }>).map((u) => u.level_id));
    const courseRows = rows(courses as Res<{ id: string; title_en: string; title_ar: string; sort: number }>);
    const moduleRows = rows(modules as Res<{ id: string; course_id: string; title_en: string; title_ar: string; sort: number }>);
    const levelRows = rows(levels as Res<{ id: string; module_id: string; level_number: number; title_en: string; title_ar: string }>);
    const levelOptions: DetailLevel[] = [];
    for (const c of courseRows) {
      for (const m of moduleRows.filter((x) => x.course_id === c.id)) {
        for (const l of levelRows.filter((x) => x.module_id === m.id)) {
          levelOptions.push({
            id: l.id,
            label: {
              en: `${c.title_en} › ${m.title_en} › ${l.level_number}: ${l.title_en}`,
              ar: `${c.title_ar} › ${m.title_ar} › ${l.level_number}: ${l.title_ar}`,
            },
            unlocked: unlocked.has(l.id),
          });
        }
      }
    }

    let verification: StudentDetail["verification"] = "unknown";
    try {
      const { data: auth } = await db.auth.admin.getUserById(studentId);
      if (auth?.user) verification = verificationState(auth.user);
    } catch {
      verification = "unknown";
    }

    const detail: StudentDetail = {
      profile,
      journey: journey.error ? null : (journey.data ?? null),
      steps: rows(steps as Res<{ step_key: string; completed_at: string }>),
      attempts: attemptRows.map((a) => ({
        id: a.id,
        testId: a.test_id,
        testTitleEn: tName.get(a.test_id)?.title_en ?? null,
        testTitleAr: tName.get(a.test_id)?.title_ar ?? null,
        status: a.status,
        percent: a.percent,
        band: a.band,
        inPerson: !!a.in_person,
        sessionId: a.session_id,
        startedAt: a.started_at,
        submittedAt: a.submitted_at,
      })),
      exercises: summariseExercises(exRows).map((s) => ({ ...s, titleEn: eName.get(s.exerciseId)?.title_en ?? null, titleAr: eName.get(s.exerciseId)?.title_ar ?? null })),
      payments: payRows.map((p) => ({ ...p, planEn: pName.get(p.plan_id)?.name_en ?? null, planAr: pName.get(p.plan_id)?.name_ar ?? null })),
      enrollments: rows(enrollments as Res<StudentDetail["enrollments"][number]>),
      questions: rows(questions as Res<StudentDetail["questions"][number]>),
      flags: rows(flags as Res<StudentDetail["flags"][number]>),
      notes: noteRows.map((n) => ({ id: n.id, body: n.body, createdAt: n.created_at, authorName: n.author_id ? (aName.get(n.author_id) ?? null) : null })),
      levels: levelOptions,
      inPersonTests: rows(tests as Res<InPersonTestRow>)
        .filter(isInPersonEligible)
        .map((t) => ({ id: t.id, slug: t.slug, title_en: t.title_en, title_ar: t.title_ar })),
      verification,
    };
    return { ok: true, detail };
  } catch (e) {
    console.error("[cc-admin] student detail failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
