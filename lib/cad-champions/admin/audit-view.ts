// Audit log viewer (Prompt 11 Step F) — PURE: filters from the URL, the date
// range, the LIKE pattern for an action prefix, and the readable before/after
// diff. The query is audit-view-server.ts.

export const AUDIT_PAGE_SIZE = 50;

/** Known action prefixes (suggestions for the filter; any prefix works). */
export const AUDIT_ACTION_PREFIXES = ["payment.", "plan.", "coupon.", "cohort.", "account.", "announcement.", "score.", "level.", "content.", "testimonial.", "student."] as const;
/** Known entity types (suggestions). */
export const AUDIT_ENTITY_TYPES = ["cc_payments", "cc_plans", "cc_coupons", "cc_cohorts", "cc_profiles", "cc_announcements", "cc_deletion_requests", "cc_content_overrides", "cc_testimonials"] as const;

export interface AuditFilters {
  /** Action starts with this (e.g. "payment."). */
  action: string;
  entity: string;
  /** Actor user id (uuid) or "". */
  actor: string;
  /** YYYY-MM-DD, Qatar calendar day (inclusive). */
  from: string;
  to: string;
  page: number;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(s: string): string {
  if (!DAY.test(s)) return "";
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : "";
}

export function parseAuditFilters(sp: Params | null | undefined): AuditFilters {
  const p = sp ?? {};
  const page = Number.parseInt(one(p.page), 10);
  const actor = one(p.actor).trim();
  return {
    action: one(p.action).trim().slice(0, 60).replace(/[^A-Za-z0-9_.:-]/g, ""),
    entity: one(p.entity).trim().slice(0, 60).replace(/[^A-Za-z0-9_.:-]/g, ""),
    actor: UUID.test(actor) ? actor.toLowerCase() : "",
    from: validDay(one(p.from).trim()),
    to: validDay(one(p.to).trim()),
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
  };
}

/** Params for links (defaults dropped). */
export function auditFilterParams(f: AuditFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.action) out.action = f.action;
  if (f.entity) out.entity = f.entity;
  if (f.actor) out.actor = f.actor;
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  return out;
}

/** "payment." -> "payment.%" with LIKE wildcards in the input escaped. */
export function actionLikePattern(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const QATAR_OFFSET = "+03:00";

/** The created_at bounds for a Qatar-day range: [gte, lt). */
export function dateRangeBounds(from: string, to: string): { gte: string | null; lt: string | null } {
  const gte = from ? new Date(`${from}T00:00:00${QATAR_OFFSET}`).toISOString() : null;
  let lt: string | null = null;
  if (to) {
    const end = new Date(`${to}T00:00:00${QATAR_OFFSET}`);
    end.setUTCDate(end.getUTCDate() + 1);
    lt = end.toISOString();
  }
  return { gte, lt };
}

export function rangeForPage(page: number, size: number = AUDIT_PAGE_SIZE): { from: number; to: number } {
  const p = Math.max(1, Math.floor(page));
  return { from: (p - 1) * size, to: p * size - 1 };
}

export function pageCount(total: number, size: number = AUDIT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

// ---------------------------------------------------------------- diff

export interface DiffEntry {
  key: string;
  before: string | null;
  after: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A short, readable value (strings unquoted, objects as compact JSON, long text clipped). */
export function formatAuditValue(v: unknown, max = 160): string {
  if (v === undefined) return "";
  let s: string;
  if (v === null) s = "null";
  else if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The keys that changed between two snapshots (top level, sorted). Null when
 * either side is not a plain object (then the UI shows both as JSON). A key
 * only on one side shows null on the other.
 */
export function diffAudit(before: unknown, after: unknown): DiffEntry[] | null {
  const b = before == null ? {} : before;
  const a = after == null ? {} : after;
  if (!isObj(b) || !isObj(a)) return null;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  const out: DiffEntry[] = [];
  for (const k of keys) {
    if (same(b[k], a[k])) continue;
    out.push({ key: k, before: k in b ? formatAuditValue(b[k]) : null, after: k in a ? formatAuditValue(a[k]) : null });
  }
  return out;
}

/** Pretty JSON for the fallback / raw view (never throws). */
export function prettyJson(v: unknown): string {
  if (v === undefined) return "";
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}
