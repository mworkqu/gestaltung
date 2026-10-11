// Home "Continue where you left off" (D4): the last projects the admin touched as a
// customer, newest first, with the Studio step each one is on. Pure shaping here; the
// one small query is in loadContinueProjects. Never reads the whole studio doc: only
// its lastStep key is selected.

import type { SupabaseClient } from "@supabase/supabase-js";

import { FLOW, type FlowStep } from "@/lib/studio/client/steps";

export const CONTINUE_LIMIT = 3;

export type ContinueRow = {
  id: string;
  name: string | null;
  updated_at: string | null;
  last_step: string | null;
};

export type ContinueProject = {
  id: string;
  name: string;
  /** null = the Studio has no remembered step yet. */
  step: FlowStep | null;
  updatedAt: string | null;
  /** Where the card links: back into the Studio at that step. */
  href: string;
};

export function isFlowStep(v: unknown): v is FlowStep {
  return typeof v === "string" && (FLOW as readonly string[]).includes(v);
}

/** Studio link for a project at a step (no step = the Studio opens where the doc says). */
export function studioHref(id: string, step: FlowStep | null): string {
  return step ? `/projects/${id}/studio?step=${step}` : `/projects/${id}/studio`;
}

/** Rows (already newest first) -> at most CONTINUE_LIMIT cards. Unknown steps are dropped, not shown. */
export function shapeContinueProjects(rows: ContinueRow[], fallbackName: string): ContinueProject[] {
  return rows.slice(0, CONTINUE_LIMIT).map((r) => {
    const step = isFlowStep(r.last_step) ? r.last_step : null;
    return {
      id: r.id,
      name: r.name?.trim() || fallbackName,
      step,
      updatedAt: r.updated_at,
      href: studioHref(r.id, step),
    };
  });
}

/**
 * The signed-in user's own projects (RLS lets a super_admin read everyone's, so the owner
 * filter is explicit), newest touched first. null = could not be read (the card says so).
 */
export async function loadContinueProjects(db: SupabaseClient, userId: string): Promise<ContinueRow[] | null> {
  const withStep = await db
    .from("projects")
    .select("id, name, updated_at, last_step:studio->>lastStep")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(CONTINUE_LIMIT);
  if (!withStep.error) return (withStep.data ?? []) as unknown as ContinueRow[];

  // Before migration 0068 there is no studio column: names only.
  const plain = await db
    .from("projects")
    .select("id, name, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(CONTINUE_LIMIT);
  if (plain.error) return null;
  return ((plain.data ?? []) as { id: string; name: string | null; updated_at: string | null }[]).map((r) => ({
    ...r,
    last_step: null,
  }));
}
