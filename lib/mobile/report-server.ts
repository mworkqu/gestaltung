import "server-only";

// Every read behind the "whole website" report. One section's worth of queries
// per function, so a table that is missing or refuses the read costs that one
// section and nothing else.
//
// The service client is used for the same reason as lib/mobile/summary-server.ts:
// the caller is already proved to be a super_admin by requireSuperAdminBearer,
// and several of these tables have owner-only RLS with no admin clause. Every
// statement here is a select; nothing in this module writes.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { since, type Report, type Section } from "@/lib/mobile/report";
import { buildCad, type AnalysisRow, type CadRow, type CreditRow, type UsageRow } from "@/lib/mobile/sections/cad";
import {
  buildChampions,
  type AttemptRow,
  type CcPaymentRow,
  type CcProfileRow,
  type CohortRow,
  type EnrollmentRow,
  type FlagRow,
  type LessonProgressRow,
  type PlanRow,
  type XpRow,
} from "@/lib/mobile/sections/champions";
import { buildOrders, type CartRow, type OrderRow, type PaymentRow, type StatusEventRow } from "@/lib/mobile/sections/orders";
import { buildPeople, type DeletionRow, type InquiryRow, type ProfileRow, type ReviewRow } from "@/lib/mobile/sections/people";
import {
  buildSourcing,
  type GapRow,
  type OfferRow,
  type SupplierRow,
  type SyncRunRow,
} from "@/lib/mobile/sections/sourcing";
import { buildStore, type OrderItemRow, type OwnStockRow, type PartRow, type SignalRow } from "@/lib/mobile/sections/store";
import { buildTraffic, parseAccessLog, type AccessEntry } from "@/lib/mobile/sections/traffic";
import { createServiceClient } from "@/lib/supabase/service";

/** Days of history every section reports on. */
export const WINDOW_DAYS = 30;

type Db = NonNullable<ReturnType<typeof createServiceClient>>;

/** Rows of one query, or [] if it failed. A section is built from what came back. */
async function rows<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  try {
    const res = await query;
    if (res.error || !Array.isArray(res.data)) return [];
    return res.data as T[];
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------- the report

export async function loadReport(): Promise<{ ok: true; data: Report } | { ok: false; error: "unavailable" }> {
  const db = createServiceClient();
  if (!db) return { ok: false, error: "unavailable" };

  const now = Date.now();
  const built = await Promise.all([
    storeSection(db, now),
    sourcingSection(db, now),
    ordersSection(db, now),
    peopleSection(db, now),
    championsSection(db, now),
    cadSection(db, now),
    trafficSection(now),
  ]);

  // Every optional field is filled in before the report leaves the server.
  //
  // The apps decode this with Swift's synthesised Codable, which does NOT fall
  // back to a property's default when a key is missing — it throws, and the
  // whole report fails to read. A section without details therefore has to send
  // `details: []` rather than leave the key out. Anything optional added to
  // Section in future belongs here too.
  const sections = built
    .filter((s): s is Section => s !== null)
    .map((s) => ({ ...s, details: s.details ?? [] }));
  const unavailable = built.map((s, i) => (s === null ? SECTION_KEYS[i] : null)).filter((k): k is string => k !== null);

  return {
    ok: true,
    data: { generatedAt: new Date(now).toISOString(), windowDays: WINDOW_DAYS, sections, unavailable },
  };
}

const SECTION_KEYS = ["store", "sourcing", "orders", "people", "champions", "cad", "traffic"];

// ----------------------------------------------------------------- sections

const PART_COLUMNS =
  "id,sku,name,category,store_category,unit_price,landed_cost_qar,lead_time_class,stock_status,is_published,merged_into,is_test,in_own_stock,created_at";

async function storeSection(db: Db, now: number): Promise<Section | null> {
  const [parts, ownStock, orders, signals] = await Promise.all([
    rows<PartRow>(db.from("parts").select(PART_COLUMNS).order("created_at", { ascending: false }).limit(3000)),
    rows<OwnStockRow>(db.from("own_stock").select("part_id,qty").limit(3000)),
    rows<{ id: string; created_at: string | null; is_test: boolean | null }>(
      db.from("part_orders").select("id,created_at,is_test").order("created_at", { ascending: false }).limit(1500),
    ),
    rows<SignalRow>(
      db
        .from("demand_signals")
        .select("kind,part_id,search_term,source_page,served_at,created_at")
        .order("created_at", { ascending: false })
        .limit(3000),
    ),
  ]);

  if (!parts.length) return null;

  const orderDay = new Map(orders.filter((o) => o.is_test !== true).map((o) => [o.id, o.created_at]));
  const items = await orderItems(db, [...orderDay.keys()]);

  return buildStore({
    parts,
    ownStock,
    orderItems: items.map((l) => ({ ...l, created_at: orderDay.get(l.order_id ?? "") ?? null })),
    signals,
    windowDays: WINDOW_DAYS,
    now,
  });
}

async function orderItems(db: Db, orderIds: string[]): Promise<OrderItemRow[]> {
  const out: OrderItemRow[] = [];
  for (let i = 0; i < orderIds.length; i += 200) {
    const chunk = orderIds.slice(i, i + 200);
    if (!chunk.length) break;
    out.push(
      ...(await rows<OrderItemRow>(
        db
          .from("part_order_items")
          .select("order_id,part_id,part_sku,part_name,quantity,line_total_qar")
          .in("order_id", chunk),
      )),
    );
  }
  return out;
}

async function sourcingSection(db: Db, now: number): Promise<Section | null> {
  const [suppliers, offers, runs, gaps] = await Promise.all([
    rows<SupplierRow>(db.from("suppliers").select("id,code,name,active,commission_percent,default_currency").limit(200)),
    rows<OfferRow>(
      db
        .from("supplier_offers")
        .select("part_id,supplier_id,cost,retail_price,currency,availability,lead_time_days,last_checked_at,active")
        .limit(5000),
    ),
    rows<SyncRunRow>(
      db
        .from("supplier_sync_runs")
        .select("supplier_code,trigger,status,started_at,finished_at,requests,checked,changed,missing,error,changes")
        .gte("started_at", since(2 * WINDOW_DAYS, now))
        .order("started_at", { ascending: false })
        .limit(120),
    ),
    rows<GapRow>(db.from("sourcing_gaps").select("function,kind,quantity,first_seen,last_seen").order("last_seen", { ascending: false }).limit(500)),
  ]);

  if (!suppliers.length && !offers.length) return null;
  return buildSourcing({ suppliers, offers, runs, gaps, windowDays: WINDOW_DAYS, now });
}

async function ordersSection(db: Db, now: number): Promise<Section | null> {
  const [orders, payments, carts] = await Promise.all([
    rows<OrderRow>(
      db
        .from("part_orders")
        .select("id,customer_name,total_qar,discount_qar,status,payment_method,delivery_area,shipping_tier,class_id,created_at,is_test")
        .order("created_at", { ascending: false })
        .limit(1500),
    ),
    rows<PaymentRow>(
      db
        .from("payments")
        .select("kind,product,amount_qar,method,status,is_test,created_at")
        .order("created_at", { ascending: false })
        .limit(1000),
    ),
    rows<CartRow>(
      db.from("cart_items").select("user_id,quantity,updated_at,part_id").order("updated_at", { ascending: false }).limit(1000),
    ),
  ]);

  if (!orders.length) return null;

  const events = await rows<StatusEventRow>(
    db
      .from("order_status_history")
      .select("order_id,status,changed_at")
      .in(
        "order_id",
        orders.slice(0, 400).map((o) => o.id),
      )
      .limit(4000),
  );

  // Names for the ids that actually appear in a basket, so the detail list can
  // say who and what instead of printing a uuid. Scoped to those ids, so this
  // stays two small reads however big the catalogue and the customer list get.
  const cartUserIds = [...new Set(carts.map((c) => c.user_id).filter(Boolean) as string[])].slice(0, 500);
  const cartPartIds = [...new Set(carts.map((c) => c.part_id).filter(Boolean) as string[])].slice(0, 500);

  const [people, partRows] = await Promise.all([
    cartUserIds.length
      ? rows<{ id: string; full_name: string | null; email: string | null }>(
          db.from("profiles").select("id,full_name,email").in("id", cartUserIds).limit(500),
        )
      : Promise.resolve([]),
    cartPartIds.length
      ? rows<{ id: string; name: string | null; sku: string | null }>(
          db.from("parts").select("id,name,sku").in("id", cartPartIds).limit(500),
        )
      : Promise.resolve([]),
  ]);

  const peopleNames: Record<string, string> = {};
  for (const p of people) {
    // A name if there is one; otherwise the part of the email before the @, which
    // is enough to recognise someone without putting a full address on screen.
    const name = p.full_name?.trim() || (p.email?.includes("@") ? p.email.split("@")[0] : "");
    if (name) peopleNames[p.id] = name;
  }

  const partNames: Record<string, string> = {};
  for (const p of partRows) {
    const name = p.name?.trim() || p.sku?.trim() || "";
    if (name) partNames[p.id] = name;
  }

  return buildOrders({ orders, events, payments, carts, peopleNames, partNames, windowDays: WINDOW_DAYS, now });
}

async function peopleSection(db: Db, now: number): Promise<Section | null> {
  const [profiles, inquiries, reviews, deletions, buyers] = await Promise.all([
    rows<ProfileRow>(db.from("profiles").select("id,role,full_name,email,phone,locale,created_at").limit(3000)),
    rows<InquiryRow>(
      db
        .from("inquiries")
        .select("id,name,status,locale,project_id,final_quote_qar,created_at,is_test")
        .order("created_at", { ascending: false })
        .limit(1000),
    ),
    rows<ReviewRow>(
      db.from("reviews").select("score,status,comment,first_name,created_at").order("created_at", { ascending: false }).limit(500),
    ),
    rows<DeletionRow>(db.from("cc_deletion_requests").select("created_at,status").order("created_at", { ascending: false }).limit(200)),
    rows<{ customer_name: string | null }>(db.from("part_orders").select("customer_name").not("is_test", "is", true).limit(2000)),
  ]);

  if (!profiles.length) return null;

  return buildPeople({
    profiles,
    inquiries,
    reviews,
    deletions,
    buyerKeys: buyers.map((b) => b.customer_name ?? "").filter(Boolean),
    windowDays: WINDOW_DAYS,
    now,
  });
}

async function championsSection(db: Db, now: number): Promise<Section | null> {
  const [students, enrollments, payments, attempts, progress, xp, plans, cohorts, flags, certificates] = await Promise.all([
    rows<CcProfileRow>(
      db
        .from("cc_profiles")
        .select("id,full_name,institution,study_level,cad_experience,preferred_locale,onboarding_completed_at,last_active_at,created_at")
        .limit(2000),
    ),
    rows<EnrollmentRow>(db.from("cc_enrollments").select("user_id,plan_id,cohort_id,status,starts_at,ends_at,created_at").limit(2000)),
    rows<CcPaymentRow>(
      db
        .from("cc_payments")
        .select("user_id,plan_id,amount_qar,discount_qar,method,status,created_at,paid_at")
        .order("created_at", { ascending: false })
        .limit(2000),
    ),
    rows<AttemptRow>(
      db
        .from("cc_attempts")
        .select("user_id,test_id,status,percent,band,started_at,submitted_at,graded_at")
        .order("started_at", { ascending: false })
        .limit(2000),
    ),
    rows<LessonProgressRow>(
      db.from("cc_lesson_progress").select("user_id,watched_percent,completed_at,updated_at").order("updated_at", { ascending: false }).limit(4000),
    ),
    rows<XpRow>(db.from("cc_student_xp").select("user_id,xp,streak_weeks").order("xp", { ascending: false }).limit(500)),
    rows<PlanRow>(db.from("cc_plans").select("id,slug,name_en,price_qar").limit(50)),
    rows<CohortRow>(db.from("cc_cohorts").select("id,name_en,starts_on,seats_total,status").limit(50)),
    rows<FlagRow>(db.from("cc_integrity_flags").select("kind,resolved_at,created_at").order("created_at", { ascending: false }).limit(500)),
    rows<{ user_id: string | null; issued_at: string | null }>(db.from("cc_certificates").select("user_id,issued_at").limit(1000)),
  ]);

  if (!students.length && !enrollments.length) return null;

  return buildChampions({
    students,
    enrollments,
    payments,
    attempts,
    progress,
    xp,
    plans,
    cohorts,
    flags,
    certificates,
    windowDays: WINDOW_DAYS,
    now,
  });
}

async function cadSection(db: Db, now: number): Promise<Section | null> {
  const [cad, analyses, usage, credits] = await Promise.all([
    rows<CadRow>(
      db
        .from("cad_generations")
        .select("project_id,user_id,tier,status,error,charged,model,created_at,delivered_at")
        .order("created_at", { ascending: false })
        .limit(2000),
    ),
    rows<AnalysisRow>(
      db
        .from("analysis_runs")
        .select("project_id,feature,provider,model,outcome,error,created_at")
        .order("created_at", { ascending: false })
        .limit(3000),
    ),
    rows<UsageRow>(
      db
        .from("ai_usage")
        .select("provider,model,feature,outcome,error_code,total_tokens,cost_usd,latency_ms,created_at,is_test")
        .order("created_at", { ascending: false })
        .limit(4000),
    ),
    rows<CreditRow>(db.from("credits_ledger").select("kind,delta,reason,created_at").order("created_at", { ascending: false }).limit(1000)),
  ]);

  if (!cad.length && !analyses.length && !usage.length) return null;
  return buildCad({ cad, analyses, usage, credits, windowDays: WINDOW_DAYS, now });
}

// ------------------------------------------------------------------- traffic

/**
 * The access log the self-hosted server writes (services/access-log.mjs). Only
 * the files inside the window are read, newest first, and the whole section is
 * skipped when the directory is not configured or does not exist — on a host
 * that is not the Mac there is no log to read.
 */
async function trafficSection(now: number): Promise<Section | null> {
  const dir = process.env.SITE_ACCESS_LOG_DIR;
  if (!dir) return null;

  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }

  const wanted = new Set<string>();
  for (let i = 0; i < WINDOW_DAYS; i += 1) {
    wanted.add(new Date(now - i * 86_400_000).toISOString().slice(0, 10));
  }

  const files = names
    .map((name) => /^access-(\d{4}-\d{2}-\d{2})\.log$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .filter((m) => wanted.has(m[1]))
    .sort((a, b) => b[1].localeCompare(a[1]));

  const entries: AccessEntry[] = [];
  for (const file of files) {
    try {
      entries.push(...parseAccessLog(await readFile(join(dir, file[0]), "utf8")));
    } catch {
      // One unreadable day does not spoil the rest.
    }
  }

  return buildTraffic({ entries, windowDays: WINDOW_DAYS, daysOnFile: files.length, now });
}
