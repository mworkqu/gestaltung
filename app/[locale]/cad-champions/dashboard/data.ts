import { cache } from "react";

import type { CcJourneyProgress } from "@/lib/cad-champions/db/types";
import { createClient } from "@/lib/supabase/server";

// Dashboard reads, through the student's own RLS client (a student reads their own
// journey, attempts and enrollments). Wrapped in React cache() so every card in one
// request shares a single round of queries.

export const DIAGNOSTIC_TEST_SLUG = "diagnostic-v1";

export type DashboardAttempt = {
  id: string;
  status: string;
  started_at: string;
  deadline_at: string | null;
  submitted_at: string | null;
};

export type DashboardEnrollment = { id: string; starts_at: string; ends_at: string };

export type DashboardData = {
  journey: CcJourneyProgress | null;
  testAvailable: boolean;
  attempt: DashboardAttempt | null;
  enrollment: DashboardEnrollment | null;
};

export type DashboardResult = { ok: true; data: DashboardData } | { ok: false };

export const loadDashboardData = cache(async (userId: string): Promise<DashboardResult> => {
  try {
    const supabase = await createClient();

    const journeyReq = supabase.from("cc_journey_progress").select("*").eq("user_id", userId).maybeSingle();
    const testReq = supabase.from("cc_tests").select("id").eq("slug", DIAGNOSTIC_TEST_SLUG).maybeSingle();
    const enrollmentReq = supabase
      .from("cc_enrollments")
      .select("id,starts_at,ends_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .gt("ends_at", new Date().toISOString())
      .order("ends_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const [journey, test, enrollment] = await Promise.all([journeyReq, testReq, enrollmentReq]);
    for (const r of [journey, test, enrollment]) {
      if (r.error) throw new Error(r.error.message);
    }

    let attempt: DashboardAttempt | null = null;
    if (test.data) {
      const attemptRes = await supabase
        .from("cc_attempts")
        .select("id,status,started_at,deadline_at,submitted_at")
        .eq("user_id", userId)
        .eq("test_id", test.data.id)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (attemptRes.error) throw new Error(attemptRes.error.message);
      attempt = (attemptRes.data as DashboardAttempt | null) ?? null;
    }

    return {
      ok: true,
      data: {
        journey: (journey.data as CcJourneyProgress | null) ?? null,
        testAvailable: Boolean(test.data),
        attempt,
        enrollment: (enrollment.data as DashboardEnrollment | null) ?? null,
      },
    };
  } catch (error) {
    // Most likely the migration has not run yet, or a network blip. Never crash the page.
    console.error("[cc dashboard] load failed", error instanceof Error ? error.message : error);
    return { ok: false };
  }
});
