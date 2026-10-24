// AI access and credits — server side. Every AI route asks canUse() before it
// calls a model and spend() after a successful result. The rules run in
// Postgres (migration 0042, SECURITY DEFINER functions), so the browser can
// never grant itself a step or a credit; these are thin, typed wrappers.
//
// Until 0042 runs, the functions do not exist: canUse() and bomRate() then let
// the call through (today's behaviour) and spend() is a no-op, with a warning
// in the server console — the feature keeps working, it just isn't metered.
//
// No free circuit (owner, 2026-10-09, migration 0052): every wiring call needs
// and spends 1 wiring credit. Until 0052 runs, the 0042 functions still treat
// a project's first circuit as free; canUse() and spend() correct that here.
//
// Server-side spend (migration 0102, audit DB-04/DB-06): the browser can no
// longer call spend_credit. spend() runs spend_credit_for through the
// service-role client with the user id the route verified (auth.getUser());
// no service key → { ok: false, error: "unavailable" } (the caller keeps its
// answer uncharged, as for any failed spend). Before 0102 runs it falls back
// to spend_credit on the caller's session.
//
// CAD code (0102 §3, audit G-C1): setCadCode() stores a generation's code
// through cad_set_code_for on the service client (the browser can no longer
// call cad_set_code, so it cannot store fake code and let cad_deliver mint a
// redeemable spend row). serverWritesReady() lets a route refuse with 503
// BEFORE it pays for a model call when the service key is missing.

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@/lib/supabase/service";
import { noFreeCircuit, type AiStep, type CanUse, type RawCanUse } from "./constants";
import { isMissingFunction } from "@/lib/supabase/errors";

type RpcError = { code?: string; message?: string } | null;

/** The function does not exist yet (0042 not run). */
const missing = (e: RpcError) =>
  !!e && (isMissingFunction(e) || /could not find the function/i.test(e.message ?? ""));

export async function canUse(supabase: SupabaseClient, step: AiStep, projectId: string | null): Promise<CanUse> {
  const { data, error } = await supabase.rpc("credit_can_use", { p_step: step, p_project: projectId });
  if (error) {
    if (missing(error)) {
      console.warn("[credits] credit_can_use missing — run migration 0042. Allowing.");
      return { allowed: true, reason: null, cost: "none", role: "user" };
    }
    console.error("[credits] credit_can_use failed:", error.message);
    return { allowed: false, reason: "not_ready", cost: null, role: "anonymous" };
  }
  return noFreeCircuit(data as RawCanUse);
}

export type SpendResult =
  | { ok: true; charged: boolean; cost: RawCanUse["cost"]; balance: number | null }
  | { ok: false; error: "sign_in" | "no_credits" | "not_found" | "unavailable" | "failed" };

/**
 * Spend 1 credit for `userId` (verified by the route with auth.getUser()) on
 * `projectId`, after a successful model answer. `supabase` = the caller's
 * session (only used before 0102 runs).
 */
export async function spend(supabase: SupabaseClient, userId: string, step: "wiring" | "cad", projectId: string): Promise<SpendResult> {
  const first = await spendOnce(supabase, userId, step, projectId);
  // Before 0052: spend_credit marks the project's first circuit as used
  // (free_wiring_used) without charging and answers cost "free". The flag is
  // now set, so a second call writes the 1-credit spend row.
  if (first.ok && step === "wiring" && first.cost === "free") return spendOnce(supabase, userId, step, projectId);
  return first;
}

async function spendOnce(supabase: SupabaseClient, userId: string, step: "wiring" | "cad", projectId: string): Promise<SpendResult> {
  const service = createServiceClient();
  if (!service) {
    console.error(`[credits] spend ${step} on ${projectId} not recorded: SUPABASE_SERVICE_ROLE_KEY is not set`);
    return { ok: false, error: "unavailable" };
  }
  let { data, error } = await service.rpc("spend_credit_for", { p_user: userId, p_step: step, p_project: projectId });
  // Before 0102: the old function on the caller's session.
  if (missing(error)) ({ data, error } = await supabase.rpc("spend_credit", { p_step: step, p_project: projectId }));
  if (error) {
    if (missing(error)) return { ok: true, charged: false, cost: "none", balance: null };
    const code = (["sign_in", "no_credits", "not_found"] as const).find((c) => error.message?.includes(c));
    console.error(`[credits] spend ${step} on ${projectId} failed:`, error.message);
    return { ok: false, error: code ?? "failed" };
  }
  const d = data as { charged: boolean; cost: RawCanUse["cost"]; balance: number | null };
  return { ok: true, charged: d.charged, cost: d.cost, balance: d.balance };
}

/** The service-role key is configured, so spend() / setCadCode() can write. */
export function serverWritesReady(): boolean {
  return createServiceClient() !== null;
}

/**
 * A spend that failed → the route's answer (AI-05: the circuit is then not
 * returned and not kept). sign_in 401, no_credits 402, not_found 404; a
 * missing service key or a database failure → 503 "unavailable" (the clients
 * show "busy, try again", not the buy-credits note). null = spent (or free:
 * included regen, pre-0042 database), or the caller is admin (`role` from
 * canUse: never charged, so a failed spend does not matter).
 */
export function spendRefusal(
  paid: SpendResult,
  role?: CanUse["role"] | null,
): { error: "sign_in" | "no_credits" | "not_found" | "unavailable"; status: number } | null {
  if (paid.ok || role === "admin") return null;
  if (paid.error === "sign_in") return { error: "sign_in", status: 401 };
  if (paid.error === "no_credits") return { error: "no_credits", status: 402 };
  if (paid.error === "not_found") return { error: "not_found", status: 404 };
  return { error: "unavailable", status: 503 };
}

export type SetCadCodeResult = { ok: true } | { ok: false; error: "unavailable" | "failed"; message: string };

/**
 * Store a validated model answer on pending generation `generationId` of
 * `userId` (verified by the route). `supabase` = the caller's session (only
 * used before 0102 runs). No service key → "unavailable" (nothing written).
 */
export async function setCadCode(
  supabase: SupabaseClient,
  userId: string,
  generationId: string,
  code: string,
  model: string | null,
): Promise<SetCadCodeResult> {
  const service = createServiceClient();
  if (!service) {
    console.error(`[credits] cad code for ${generationId} not stored: SUPABASE_SERVICE_ROLE_KEY is not set`);
    return { ok: false, error: "unavailable", message: "service_unavailable" };
  }
  let { error } = await service.rpc("cad_set_code_for", { p_user: userId, p_id: generationId, p_scad: code, p_model: model });
  // Before 0102: the old function on the caller's session.
  if (missing(error)) ({ error } = await supabase.rpc("cad_set_code", { p_id: generationId, p_scad: code, p_model: model }));
  if (error) return { ok: false, error: "failed", message: error.message ?? "failed" };
  return { ok: true };
}

/**
 * Put a project's bom + netlist back as they were before buildElectronics
 * saved an unpaid circuit (AI-05). Best effort: a failure is logged.
 */
export async function undoUnpaidCircuit(
  supabase: SupabaseClient,
  project: { id: string; bom: unknown; netlist: unknown },
  tag: string,
): Promise<void> {
  const { error } = await supabase.from("projects").update({ bom: project.bom, netlist: project.netlist }).eq("id", project.id);
  if (error) console.error(`[${tag}] ${project.id}: unpaid circuit not rolled back:`, error.message);
}

/** The caller's IP, hashed with a server secret — never stored in the clear (also the Studio guest limit). */
export function ipHash(request: Request): string | null {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "";
  if (!ip) return null;
  const salt = process.env.AI_RATE_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || "gestaltung-rate";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export type RateResult = { allowed: boolean; used: number; limit: number | null };

/** Counts one BOM run against today's allowance (anonymous 5, user 30, admin ∞). */
export async function bomRate(supabase: SupabaseClient, request: Request): Promise<RateResult> {
  // Turnstile (P2-08): guests' /api/analyse calls are checked in the route
  // (lib/turnstile-server.ts checkTurnstile) before this runs, while the
  // store_settings switch is on. /api/bom/electronics is not checked yet.
  const { data, error } = await supabase.rpc("bom_rate_check", { p_ip_hash: ipHash(request) });
  if (error) {
    if (!missing(error)) console.error("[credits] bom_rate_check failed:", error.message);
    else console.warn("[credits] bom_rate_check missing — run migration 0042. Allowing.");
    return { allowed: true, used: 0, limit: null };
  }
  const d = data as { allowed: boolean; used: number; limit: number | null };
  return { allowed: d.allowed, used: d.used, limit: d.limit };
}
