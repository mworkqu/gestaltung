// Mint a worker token for the caller (POST /api/worker-token). SERVER ONLY.
//
// Reads with the caller's own cookie-bound client (RLS): the profile role for
// is_admin, the project row for ownership, idea_token_status (0088) for the
// project's stored tier. A project the caller does not own is refused unless
// they are a super_admin — the same rule as the Studio product routes
// (studioRequest owner: true). Credits are deliberately NOT in the token: the
// worker spends or checks them in the database when it does the paid work.

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { TIER_IDS } from "@/lib/studio/tiers";
import { signWorkerToken } from "@/lib/worker/token";

export type MintResult =
  | { ok: true; token: string; expiresAt: string; projectId: string | null; tier: string | null; isAdmin: boolean }
  | { ok: false; error: "not_found" };

async function isSuperAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.from("profiles").select("role").eq("id", userId).maybeSingle<{ role: string | null }>();
  return data?.role === "super_admin";
}

async function storedTier(supabase: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("idea_token_status", { p_project: projectId });
  if (error) return null;
  const tier = (data as { tier?: unknown } | null)?.tier;
  return typeof tier === "string" && (TIER_IDS as readonly string[]).includes(tier) ? tier : null;
}

export async function mintWorkerTokenFor(
  supabase: SupabaseClient,
  user: User,
  projectId: string | null,
  secret: string,
  nowMs: number = Date.now(),
): Promise<MintResult> {
  const isAdmin = await isSuperAdmin(supabase, user.id);
  let tier: string | null = null;
  if (projectId) {
    const { data: project, error } = await supabase.from("projects").select("id, user_id").eq("id", projectId).maybeSingle<{ id: string; user_id: string | null }>();
    if (error || !project) return { ok: false, error: "not_found" };
    if (project.user_id !== user.id && !isAdmin) return { ok: false, error: "not_found" };
    tier = await storedTier(supabase, projectId);
  }
  const { token, claims } = signWorkerToken(
    { userId: user.id, projectId, tier, isAdmin, isAnonymous: user.is_anonymous === true },
    secret,
    { nowMs },
  );
  return { ok: true, token, expiresAt: new Date(claims.exp * 1000).toISOString(), projectId, tier, isAdmin };
}
