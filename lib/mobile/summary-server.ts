import {
  buildDetail,
  buildSummary,
  type EventInput,
  type IdeaDetail,
  type InquiryInput,
  type MobileSummary,
  type ProfileInput,
  type ProjectInput,
  type RunInput,
  type SessionInput,
  type UsageInput,
} from "@/lib/mobile/summary";
import { paged } from "@/lib/mobile/paged";
import { createServiceClient } from "@/lib/supabase/service";

// Reads for the phone dashboard. The service client is used because the caller
// is already proved to be a super_admin by requireSuperAdminBearer, and several
// of these tables have owner-only RLS policies with no admin clause — so an
// admin reading them through the anon client would legitimately see nothing.
// Every statement here is a select; nothing in this module writes.

/** Columns the list view needs. `studio` is the big one — only the summary reads it, and only for the keys it shows. */
const PROJECT_COLUMNS =
  "id,user_id,name,notes,brief,stage,status,build_route,is_test,contact_email,created_at,updated_at,studio";
const RUN_COLUMNS = "id,project_id,feature,model,outcome,error,created_at";

export type MobileResult<T> = { ok: true; data: T } | { ok: false; error: "unavailable" | "not_found" };

export async function loadSummary({ includeTest }: { includeTest: boolean }): Promise<MobileResult<MobileSummary>> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  // Caps keep the payload and the query time bounded; the dashboard shows
  // recent work, and an older project is still reachable by id.
  const [projects, runs, sessions, profiles, usage, inquiries] = await Promise.all([
    db.from("projects").select(PROJECT_COLUMNS).order("updated_at", { ascending: false }).limit(300),
    db.from("analysis_runs").select(RUN_COLUMNS).order("created_at", { ascending: false }).limit(1000),
    db.from("idea_sessions").select("project_id,edit_turns,tier").limit(1000),
    db.from("profiles").select("id,full_name,email,role").limit(1000),
    // Past the 1,000 rows one request is answered with, so read in pages.
    paged<UsageInput>(
      (from, to) =>
        db
          .from("ai_usage")
          .select("project_id,outcome,error_code,cost_usd,created_at,is_test")
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
      2000,
    ),
    db
      .from("inquiries")
      .select("id,project_id,name,status,final_quote_qar,created_at,is_test")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  return {
    ok: true,
    data: buildSummary({
      projects: (projects.data ?? []) as unknown as ProjectInput[],
      runs: (runs.data ?? []) as unknown as RunInput[],
      sessions: (sessions.data ?? []) as unknown as SessionInput[],
      profiles: (profiles.data ?? []) as unknown as ProfileInput[],
      usage: usage.rows,
      inquiries: (inquiries.data ?? []) as unknown as InquiryInput[],
      includeTest,
      now: new Date(),
    }),
  };
}

export async function loadDetail(projectId: string): Promise<MobileResult<IdeaDetail>> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  const { data: project } = await db
    .from("projects")
    .select(PROJECT_COLUMNS)
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, error: "not_found" };

  const row = project as unknown as ProjectInput;

  const [runs, events, session, inquiry, owner] = await Promise.all([
    db
      .from("analysis_runs")
      .select(RUN_COLUMNS)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(60),
    db
      .from("project_events")
      .select("id,project_id,type,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(80),
    db.from("idea_sessions").select("project_id,edit_turns,tier").eq("project_id", projectId).maybeSingle(),
    db
      .from("inquiries")
      .select("id,project_id,name,status,final_quote_qar,created_at,is_test")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    row.user_id
      ? db.from("profiles").select("id,full_name,email,role").eq("id", row.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    ok: true,
    data: buildDetail({
      project: row,
      runs: (runs.data ?? []) as unknown as RunInput[],
      events: (events.data ?? []) as unknown as EventInput[],
      session: (session.data ?? undefined) as unknown as SessionInput | undefined,
      owner: (owner.data ?? undefined) as unknown as ProfileInput | undefined,
      inquiry: (inquiry.data ?? undefined) as unknown as InquiryInput | undefined,
      now: new Date(),
    }),
  };
}
