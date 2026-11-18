// Audit log reader — SERVER ONLY (service role). The CALLER (the admin page)
// has already passed requireCcAdmin. One page of cc_audit_log (server-side
// range + exact count) with the actors' names, plus the staff list for the
// actor filter.

import type { CcAuditLog } from "../db/types";
import { AUDIT_PAGE_SIZE, actionLikePattern, dateRangeBounds, rangeForPage, type AuditFilters } from "./audit-view";
import { isMissingSchema, type AdminDb } from "./server";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/admin/audit-view-server.ts is server-only");

export interface AuditRow {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export interface StaffOption {
  id: string;
  label: string;
}

export type AuditLoad = { ok: true; rows: AuditRow[]; total: number } | { ok: false; reason: "not_set_up" | "error" };

export async function loadAuditPage(db: AdminDb, f: AuditFilters): Promise<AuditLoad> {
  try {
    const { from, to } = rangeForPage(f.page, AUDIT_PAGE_SIZE);
    let q = db.from("cc_audit_log").select("*", { count: "exact" });
    if (f.action) q = q.like("action", actionLikePattern(f.action));
    if (f.entity) q = q.eq("entity_type", f.entity);
    if (f.actor) q = q.eq("actor_id", f.actor);
    const { gte, lt } = dateRangeBounds(f.from, f.to);
    if (gte) q = q.gte("created_at", gte);
    if (lt) q = q.lt("created_at", lt);
    const { data, error, count } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to);
    if (error) return { ok: false, reason: isMissingSchema(error.code) ? "not_set_up" : "error" };
    const list = (data ?? []) as CcAuditLog[];
    const actorIds = [...new Set(list.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const actors = new Map<string, { name: string | null; email: string | null }>();
    if (actorIds.length > 0) {
      const { data: ps } = await db.from("cc_profiles").select("id,full_name,email").in("id", actorIds);
      for (const p of (ps ?? []) as { id: string; full_name: string | null; email: string | null }[]) actors.set(p.id, { name: p.full_name, email: p.email });
    }
    return {
      ok: true,
      total: count ?? list.length,
      rows: list.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        actorId: r.actor_id,
        actorName: r.actor_id ? (actors.get(r.actor_id)?.name ?? null) : null,
        actorEmail: r.actor_id ? (actors.get(r.actor_id)?.email ?? null) : null,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        before: r.before,
        after: r.after,
      })),
    };
  } catch (e) {
    console.error("[cc-admin] audit read failed:", e instanceof Error ? e.message : "unknown");
    return { ok: false, reason: "error" };
  }
}

/** Instructors and admins (the people who write audit rows) for the actor filter. */
export async function loadStaffOptions(db: AdminDb): Promise<StaffOption[]> {
  const { data, error } = await db.from("cc_profiles").select("id,full_name,email").in("role", ["admin", "instructor"]).order("full_name").limit(200);
  if (error) return [];
  return ((data ?? []) as { id: string; full_name: string | null; email: string | null }[]).map((p) => ({ id: p.id, label: p.full_name || p.email || p.id.slice(0, 8) }));
}
