// "Is this project a school class project?" — the one server-side answer that
// safety mode, the suppressed prompts and the school print rule all read.
//
// It calls public.is_class_project() (migration 0096, SECURITY DEFINER), so an
// anonymous team can ask about its own project without being able to read
// school_classes. Before 0096 runs the function does not exist and the answer
// is false, i.e. today's behaviour: no class, no safety mode.

import type { SupabaseClient } from "@supabase/supabase-js";

type RpcError = { code?: string; message?: string } | null;

/** The function does not exist yet (0096 not run). */
const missing = (e: RpcError) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? ""));

let warned = false;

export async function isClassProject(supabase: SupabaseClient, projectId: string | null): Promise<boolean> {
  if (!projectId) return false;
  const { data, error } = await supabase.rpc("is_class_project", { p_project: projectId });
  if (error) {
    if (missing(error)) {
      if (!warned) {
        warned = true;
        console.warn("[schools] is_class_project missing — run migration 0096. Treating projects as non-class.");
      }
      return false;
    }
    // Fail CLOSED for safety mode would block every normal project, so fail
    // open on a transient error but say so.
    console.error("[schools] is_class_project failed:", error.message);
    return false;
  }
  return data === true;
}

export type ClassTeamContext = {
  teamId: string;
  teamName: string;
  classId: string;
  className: string;
  schoolName: string;
};

/**
 * The class a project belongs to, read under RLS: a team sees its own row, the
 * class teacher sees their teams', nobody else sees anything. null for a normal
 * project, before 0096, or when the caller may not see the row.
 */
export async function classTeamOf(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ClassTeamContext | null> {
  const { data, error } = await supabase
    .from("class_teams")
    .select("id, team_name, class_id, school_classes(name, school_name)")
    .eq("project_id", projectId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as {
    id: string;
    team_name: string;
    class_id: string;
    school_classes: { name: string; school_name: string } | null;
  };
  return {
    teamId: row.id,
    teamName: row.team_name,
    classId: row.class_id,
    className: row.school_classes?.name ?? "",
    schoolName: row.school_classes?.school_name ?? "",
  };
}
