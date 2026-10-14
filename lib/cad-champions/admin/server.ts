// CAD Champions admin — SERVER ONLY helpers shared by every admin page and
// server action (Prompt 11).
//
//   adminGuard("admin" | "staff") -> { ok: true, cc, db } | { ok: false, error }
//       Call at the top of EVERY server action: it re-checks the role on the
//       server (never trust the page) and hands back the service client.
//   writeAudit(db, actorId, action, entityType, entityId, before, after)
//       Appends to cc_audit_log; never throws (logs instead).
//   isMissingSchema(code)  table/column missing = migration not run yet.
//   adminDb()              the service client or null.

import { getCcUser, type CcUser } from "@/lib/cad-champions/auth/server";
import { createServiceClient } from "@/lib/supabase/service";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/server.ts is server-only");

export type AdminDb = NonNullable<ReturnType<typeof createServiceClient>>;

export type AdminGuardError = "forbidden" | "unavailable";

export type AdminGuard = { ok: true; cc: CcUser; db: AdminDb } | { ok: false; error: AdminGuardError };

/** Postgres / PostgREST "table or column does not exist" (migration not run yet). */
export function isMissingSchema(code: string | undefined | null): boolean {
  return code === "42P01" || code === "PGRST205" || code === "PGRST204" || code === "42703" || code === "PGRST202" || code === "42883";
}

export function adminDb(): AdminDb | null {
  return createServiceClient();
}

/**
 * Role check for server actions and route handlers. "staff" = instructor or
 * admin, "admin" = admin only. Returns the service client (RLS bypassed), so
 * the caller MUST have passed this check before touching data.
 */
export async function adminGuard(level: "admin" | "staff" = "admin"): Promise<AdminGuard> {
  const cc = await getCcUser();
  if (!cc || !(level === "admin" ? cc.isAdmin : cc.isStaff)) return { ok: false, error: "forbidden" };
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };
  return { ok: true, cc, db };
}

/** Audit log entry (who/what/when/before/after). Never throws. */
export async function writeAudit(
  db: AdminDb,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  before: unknown = null,
  after: unknown = null,
): Promise<void> {
  try {
    const { error } = await db.from("cc_audit_log").insert({
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      before: before ?? null,
      after: after ?? null,
    });
    if (error) console.error("[cc-admin] audit write failed:", error.code ?? error.message);
  } catch (e) {
    console.error("[cc-admin] audit write failed:", e instanceof Error ? e.message : "unknown");
  }
}

/** Uniform result for admin server actions (the UI maps `error` to a message key). */
export type ActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: AdminGuardError | "invalid" | "not_set_up" | "not_found" | "conflict" | "error"; detail?: string };
