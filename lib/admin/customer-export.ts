// The owner-only customer export: everything the business holds about one
// person, in one JSON. Server-only. Read by
// /api/admin/customers/<id>/export (super_admin), and the same shape the
// /dashboard/customers/<id> page shows on screen.
//
// Modelled on lib/admin/project-export.ts: every read is soft, so a table that
// is missing or closed to us is reported in `_notes` instead of failing the
// whole file, and the result goes through the same `redactKeys` so a stray API
// key inside a stored payload never leaves the server.
//
// cart_items is deliberately absent: it has no super_admin policy (0016), so
// an open basket is the customer's own business.

import type { SupabaseClient } from "@supabase/supabase-js";

import { callCostUsd } from "@/lib/ai/prices";
import { normalizePhone } from "@/lib/phone";
import { redactKeys } from "@/lib/admin/project-export";
import { round2 } from "@/lib/format/money";
import { LEAD_LIMIT, loadCustomerBundle, type CustomerSection } from "@/lib/admin/customer-data";

export const CUSTOMER_EXPORT_VERSION = 1;

type Row = Record<string, unknown>;

/** A lead row as it matters for matching it to a person. */
export type LeadLike = {
  email?: string | null;
  phone?: string | null;
  project_id?: string | null;
};

/** Who the lead could belong to: the profile's own contact details + their projects. */
export type CustomerIdentity = {
  email?: string | null;
  phone?: string | null;
  projectIds?: Iterable<string>;
};

/**
 * True when an inquiry belongs to this person. `inquiries` carries no user_id
 * (0002), so the only honest links are the project it was raised from (0073)
 * and the contact details the visitor typed — email case-insensitively, phone
 * through the same normalisation the lead routes use, so "66567410" and
 * "+974 6656 7410" are one number.
 */
export function leadMatchesCustomer(lead: LeadLike, who: CustomerIdentity): boolean {
  const ids = new Set(who.projectIds ?? []);
  if (lead.project_id && ids.has(lead.project_id)) return true;
  const mine = (who.email ?? "").trim().toLowerCase();
  const theirs = (lead.email ?? "").trim().toLowerCase();
  if (mine && theirs && mine === theirs) return true;
  const myPhone = normalizePhone(who.phone ?? "");
  const theirPhone = normalizePhone(lead.phone ?? "");
  return !!myPhone && myPhone === theirPhone;
}

/** What this person has actually paid us, in QAR. */
export type PaidInput = {
  payments?: { amount_qar?: number | string | null; status?: string | null }[];
  orders?: { total_qar?: number | string | null; status?: string | null }[];
};

/** Payments we approved, plus every part order that was not cancelled. */
export function totalPaidQar(input: PaidInput): number {
  const money = (v: number | string | null | undefined) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const fromPayments = (input.payments ?? [])
    .filter((p) => p.status === "approved")
    .reduce((s, p) => s + money(p.amount_qar), 0);
  const fromOrders = (input.orders ?? [])
    .filter((o) => o.status !== "cancelled")
    .reduce((s, o) => s + money(o.total_qar), 0);
  return round2(fromPayments + fromOrders);
}

/** The newest of a set of timestamps, or null when there is nothing to show. */
export function lastActiveAt(stamps: (string | null | undefined)[]): string | null {
  return stamps.filter((s): s is string => !!s).sort().pop() ?? null;
}

/**
 * The file-name part of a customer export: letters and digits from the email
 * or name, dash-joined, so `ali@example.com` becomes `ali-example-com`.
 * Mirrors the project export's slug, including the 40-character cap.
 */
export function customerFileSlug(label: string | null | undefined): string {
  const slug = String(label ?? "customer")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "customer";
}

export type AiModelSummary = {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  unpriced: boolean;
  lastCallAt: string | null;
};

export type AiUsageLike = {
  model?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  audio_seconds?: number | null;
  cost_usd?: number | string | null;
  outcome?: string | null;
  created_at?: string | null;
};

/**
 * ai_usage rolled up per model, newest call first within each row. `blocked`
 * calls never reached a provider, so they cost nothing and are not counted.
 * A row with no stored cost is priced at the provider's list price; when even
 * that is unknown the model is flagged `unpriced` rather than counted as free.
 */
export function aiUsageByModel(rows: AiUsageLike[]): AiModelSummary[] {
  const by = new Map<string, AiModelSummary>();
  for (const r of rows) {
    if (r.outcome === "blocked") continue;
    const model = r.model ?? "—";
    const a =
      by.get(model) ??
      { model, calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0, unpriced: false, lastCallAt: null };
    a.calls += 1;
    a.promptTokens += r.prompt_tokens ?? 0;
    a.completionTokens += r.completion_tokens ?? 0;
    const cost =
      r.cost_usd != null
        ? Number(r.cost_usd)
        : callCostUsd({
            model: r.model,
            promptTokens: r.prompt_tokens,
            completionTokens: r.completion_tokens,
            totalTokens: r.total_tokens,
            audioSeconds: r.audio_seconds,
          });
    if (cost == null || !Number.isFinite(cost)) a.unpriced = true;
    else a.costUsd += cost;
    if (r.created_at && (!a.lastCallAt || r.created_at > a.lastCallAt)) a.lastCallAt = r.created_at;
    by.set(model, a);
  }
  return [...by.values()].sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
}

/** The export's wording for a section that could not be read (`_notes`). */
const SECTION_LABEL: Record<CustomerSection, string> = {
  profile: "profile",
  projects: "projects",
  orders: "part orders",
  leads: "leads",
  ledger: "credits ledger",
  payments: "payments",
  pass: "idea pass",
  sessions: "idea sessions",
  usage: "ai usage",
  jobs: "engineering jobs",
  cad: "cad generations",
  signals: "demand signals",
  outbox: "notification outbox",
  items: "order items",
};

export async function buildCustomerExport(
  db: SupabaseClient,
  userId: string,
  opts: { service: SupabaseClient | null; exportedBy: string }
): Promise<Row | null> {
  const notes: string[] = [];
  const { profile, projects, orders, leadRows, ledger, payments, pass, sessions, usage, jobs, cad, signals, outbox, items } =
    await loadCustomerBundle(db, userId, {
      onError: (section, error) => notes.push(`${SECTION_LABEL[section]}: not readable (${error.message})`),
    });

  // Nothing at all under this id, not even a profile row: there is no customer.
  // (No orders also means the order-items read never ran.)
  if (!profile && !projects?.length && !orders?.length && !payments?.length) return null;

  const projectIds = (projects ?? []).map((p) => String(p.id));

  const identity: CustomerIdentity = {
    email: (profile?.email as string | null) ?? null,
    phone: (profile?.phone as string | null) ?? null,
    projectIds,
  };
  const leads = (leadRows ?? []).filter((l) => leadMatchesCustomer(l as LeadLike, identity));
  if (leadRows && leadRows.length >= LEAD_LIMIT)
    notes.push(`leads: only the newest ${LEAD_LIMIT} inquiries were scanned for a match`);

  // Identity: email / sign-in times live in auth.users, which needs the service key.
  let auth: Row | null = null;
  if (opts.service) {
    const { data, error } = await opts.service.auth.admin.getUserById(userId);
    if (error) notes.push(`auth record: not readable (${error.message})`);
    else if (data?.user)
      auth = {
        email: data.user.email ?? null,
        phone: data.user.phone ?? null,
        isAnonymous: (data.user as { is_anonymous?: boolean }).is_anonymous ?? null,
        signedUpAt: data.user.created_at,
        lastSignInAt: data.user.last_sign_in_at ?? null,
        emailConfirmedAt: data.user.email_confirmed_at ?? null,
        provider: (data.user.app_metadata as { provider?: string } | null)?.provider ?? null,
      };
  } else notes.push("auth record: SUPABASE_SERVICE_ROLE_KEY not set on this server, so only the profile is shown");

  const paid = totalPaidQar({
    payments: (payments ?? []) as PaidInput["payments"],
    orders: (orders ?? []) as PaidInput["orders"],
  });
  const aiByModel = aiUsageByModel((usage ?? []) as AiUsageLike[]);

  const out: Row = {
    exportedAt: new Date().toISOString(),
    exportVersion: CUSTOMER_EXPORT_VERSION,
    exportedBy: opts.exportedBy,
    customer: {
      id: userId,
      email: (auth?.email as string | null) ?? (profile?.email as string | null) ?? null,
      fullName: (profile?.full_name as string | null) ?? null,
      role: (profile?.role as string | null) ?? null,
      phone: (profile?.phone as string | null) ?? null,
      locale: (profile?.locale as string | null) ?? null,
      auth,
      profile,
    },
    totals: {
      projects: projects?.length ?? 0,
      orders: orders?.length ?? 0,
      orderItems: items?.length ?? 0,
      leads: leads.length,
      aiCalls: aiByModel.reduce((s, m) => s + m.calls, 0),
      aiCostUsd: Math.round(aiByModel.reduce((s, m) => s + m.costUsd, 0) * 1e6) / 1e6,
      engineeringJobs: jobs?.length ?? 0,
      cadGenerations: cad?.length ?? 0,
      totalPaidQar: paid,
      lastActiveAt: lastActiveAt([
        profile?.created_at as string | null,
        ...(projects ?? []).map((p) => (p.updated_at ?? p.created_at) as string | null),
        ...(orders ?? []).map((o) => (o.updated_at ?? o.created_at) as string | null),
        ...(payments ?? []).map((p) => p.created_at as string | null),
        ...leads.map((l) => l.created_at as string | null),
        ...aiByModel.map((m) => m.lastCallAt),
        (auth?.lastSignInAt as string | null) ?? null,
      ]),
    },
    projects: projects ?? [],
    orders: (orders ?? []).map((o) => ({ ...o, items: (items ?? []).filter((i) => i.order_id === o.id) })),
    leads,
    creditsLedger: ledger ?? [],
    payments: payments ?? [],
    ideaPass: pass ?? null,
    ideaSessions: sessions ?? [],
    aiUsageByModel: aiByModel,
    aiUsage: usage ?? [],
    engineeringJobs: jobs ?? [],
    cadGenerations: cad ?? [],
    demandSignals: signals ?? [],
    notificationOutbox: outbox ?? [],
    _notes: notes,
  };
  notes.push("cart_items is not included: it has no super_admin policy (migration 0016), by design.");
  return redactKeys(out);
}
