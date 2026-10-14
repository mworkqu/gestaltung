// Admin student rows — SERVER ONLY (service role). The CALLER checks the role
// first (requireCcStaff / adminGuard). Reads every student once with only
// the needed columns (paged past PostgREST's 1,000-row cap) and builds
// StudentRow[]; filtering, sorting, paging and CSV are pure (students.ts).

import { fetchAllRows } from "@/lib/supabase/fetch-all";

import type { CcBand, CcStudyLevel } from "../db/types";
import { REQUIRED_STEP_KEYS } from "../get-ready/steps";
import type { AdminDb } from "./server";
import { isMissingSchema } from "./server";
import type { StudentRow } from "./students";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/students-server.ts is server-only");

export type StudentRowsLoad = { ok: true; rows: StudentRow[] } | { ok: false; reason: "not_set_up" | "error" };

type ProfileRow = {
  id: string;
  full_name: string | null;
  full_name_ar: string | null;
  email: string | null;
  phone: string | null;
  institution: string | null;
  institution_other: string | null;
  study_level: CcStudyLevel | null;
  is_minor: boolean;
  marketing_consent: boolean;
  preferred_locale: "en" | "ar";
  get_ready_bypass: boolean;
  deletion_requested_at: string | null;
  last_active_at: string | null;
  created_at: string;
};

const PROFILE_COLUMNS =
  "id,full_name,full_name_ar,email,phone,institution,institution_other,study_level,is_minor,marketing_consent,preferred_locale,get_ready_bypass,deletion_requested_at,last_active_at,created_at";

/** Every student (role student). `ids` limits the read (e.g. one student). */
export async function loadStudentRows(db: AdminDb, opts: { ids?: string[] } = {}): Promise<StudentRowsLoad> {
  try {
    const ids = opts.ids?.filter((x) => /^[0-9a-f-]{36}$/i.test(x));
    const profiles = await fetchAllRows<ProfileRow>((from, to) => {
      const q = db.from("cc_profiles").select(PROFILE_COLUMNS).eq("role", "student");
      return (ids ? q.in("id", ids) : q).order("id").range(from, to);
    });
    if (profiles.error) return { ok: false, reason: isMissingSchema(profiles.error.code) ? "not_set_up" : "error" };
    if (profiles.rows.length === 0) return { ok: true, rows: [] };
    const userIds = ids ?? null;

    const [steps, journey, attempts, tests, enrollments, flags] = await Promise.all([
      fetchAllRows<{ user_id: string; step_key: string }>((f, t) =>
        (userIds ? db.from("cc_get_ready_steps").select("user_id,step_key").in("user_id", userIds) : db.from("cc_get_ready_steps").select("user_id,step_key"))
          .order("user_id")
          .order("step_key")
          .range(f, t),
      ),
      fetchAllRows<{ user_id: string; get_ready_completed_at: string | null }>((f, t) =>
        (userIds ? db.from("cc_journey_progress").select("user_id,get_ready_completed_at").in("user_id", userIds) : db.from("cc_journey_progress").select("user_id,get_ready_completed_at"))
          .order("user_id")
          .range(f, t),
      ),
      fetchAllRows<{ id: string; user_id: string; test_id: string; percent: number | null; band: CcBand | null; submitted_at: string | null }>((f, t) =>
        (userIds
          ? db.from("cc_attempts").select("id,user_id,test_id,percent,band,submitted_at").in("user_id", userIds)
          : db.from("cc_attempts").select("id,user_id,test_id,percent,band,submitted_at")
        )
          .not("submitted_at", "is", null)
          .order("id")
          .range(f, t),
      ),
      db.from("cc_tests").select("id,type"),
      fetchAllRows<{ user_id: string; ends_at: string; status: string }>((f, t) =>
        (userIds ? db.from("cc_enrollments").select("user_id,ends_at,status").in("user_id", userIds) : db.from("cc_enrollments").select("user_id,ends_at,status"))
          .eq("status", "active")
          .order("user_id")
          .range(f, t),
      ),
      fetchAllRows<{ user_id: string | null }>((f, t) =>
        (userIds ? db.from("cc_integrity_flags").select("user_id").in("user_id", userIds) : db.from("cc_integrity_flags").select("user_id"))
          .is("resolved_at", null)
          .order("id")
          .range(f, t),
      ),
    ]);

    const required = new Set<string>(REQUIRED_STEP_KEYS);
    const stepCount = new Map<string, number>();
    for (const s of steps.rows) if (required.has(s.step_key)) stepCount.set(s.user_id, (stepCount.get(s.user_id) ?? 0) + 1);
    const grDone = new Map(journey.rows.map((j) => [j.user_id, j.get_ready_completed_at]));
    const practice = new Set(((tests.data ?? []) as { id: string; type: string }[]).filter((t) => t.type === "practice" || t.type === "exercise").map((t) => t.id));
    const latest = new Map<string, { percent: number | null; band: CcBand | null; at: string }>();
    for (const a of attempts.rows) {
      if (practice.has(a.test_id) || !a.submitted_at) continue;
      const cur = latest.get(a.user_id);
      if (!cur || Date.parse(a.submitted_at) > Date.parse(cur.at)) latest.set(a.user_id, { percent: a.percent, band: a.band, at: a.submitted_at });
    }
    const enrolled = new Map<string, string>();
    for (const e of enrollments.rows) {
      const cur = enrolled.get(e.user_id);
      if (!cur || Date.parse(e.ends_at) > Date.parse(cur)) enrolled.set(e.user_id, e.ends_at);
    }
    const flagCount = new Map<string, number>();
    for (const fl of flags.rows) if (fl.user_id) flagCount.set(fl.user_id, (flagCount.get(fl.user_id) ?? 0) + 1);

    const total = required.size || 1;
    const rows: StudentRow[] = profiles.rows.map((p) => {
      const done = grDone.get(p.id) ?? null;
      const pct = done || p.get_ready_bypass ? 100 : Math.round((Math.min(stepCount.get(p.id) ?? 0, total) / total) * 100);
      const l = latest.get(p.id);
      return {
        id: p.id,
        name: p.full_name,
        nameAr: p.full_name_ar,
        email: p.email,
        phone: p.phone,
        institution: p.institution || p.institution_other || null,
        studyLevel: p.study_level,
        isMinor: !!p.is_minor,
        marketingConsent: !!p.marketing_consent,
        preferredLocale: p.preferred_locale === "ar" ? "ar" : "en",
        getReadyPercent: pct,
        getReadyDoneAt: done,
        getReadyBypass: !!p.get_ready_bypass,
        latestPercent: l?.percent ?? null,
        latestBand: l?.band ?? null,
        latestAttemptAt: l?.at ?? null,
        enrolledUntil: enrolled.get(p.id) ?? null,
        lastActiveAt: p.last_active_at,
        createdAt: p.created_at,
        openFlags: flagCount.get(p.id) ?? 0,
        deletionRequested: !!p.deletion_requested_at,
      };
    });
    return { ok: true, rows };
  } catch (e) {
    console.error("[cc-admin] student rows failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}
