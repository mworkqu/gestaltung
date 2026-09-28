// Server-only: daily refresh of Mouser and DigiKey offers (Task 19e). One
// lookup per linked offer per day, oldest-checked first, paced under each
// API's per-minute limit and stopped well inside the daily one. Writes
// NUMBERS ONLY (cost, currency, availability, lead time) and applies them
// directly — the owner chose no approval queue. Each supplier's run is
// logged in supplier_sync_runs; the owner is emailed what moved.

import type { SupabaseClient } from "@supabase/supabase-js";

import { escapeHtml, OWNER_EMAIL, sendEmail } from "@/lib/email";
import { digikeyConfigured, digikeyPart } from "@/lib/sourcing/adapters/digikey";
import { mouserConfigured, mouserPart } from "@/lib/sourcing/adapters/mouser";
import type { SupplierProduct } from "@/lib/sourcing/types";

type Code = "mouser" | "digikey";

const CONFIG: Record<Code, { gapMs: number; maxPerRun: number; lookup: (sku: string) => Promise<SupplierProduct | null>; ready: () => boolean }> = {
  // Mouser: 30 calls/minute, 1,000/day.
  mouser: { gapMs: 2100, maxPerRun: 800, lookup: mouserPart, ready: mouserConfigured },
  // DigiKey: 120 calls/minute on the free tier.
  digikey: { gapMs: 600, maxPerRun: 800, lookup: digikeyPart, ready: digikeyConfigured },
};

const TIME_BUDGET_MS = 250_000; // stay inside the 300 s function limit
const MIN_HOURS_BETWEEN_RUNS = 20;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Change = { partName: string; sku: string; field: string; from: string | number | null; to: string | number | null };

export async function runApiRefresh(db: SupabaseClient, trigger: "cron" | "manual") {
  const started = Date.now();
  const summary: Record<string, unknown> = {};
  const allChanges: (Change & { supplier: Code })[] = [];

  for (const code of ["mouser", "digikey"] as Code[]) {
    const cfg = CONFIG[code];
    if (!cfg.ready()) {
      summary[code] = "not_configured";
      continue;
    }
    const since = new Date(Date.now() - MIN_HOURS_BETWEEN_RUNS * 3600_000).toISOString();
    const { data: recent } = await db
      .from("supplier_sync_runs")
      .select("id")
      .eq("supplier_code", code)
      .eq("status", "ok")
      .gte("started_at", since)
      .limit(1);
    if (recent?.length) {
      summary[code] = "already_ran_today";
      continue;
    }

    const { data: sup } = await db.from("suppliers").select("id, active").eq("code", code).maybeSingle();
    if (!sup?.active) {
      summary[code] = "supplier_inactive";
      continue;
    }
    const { data: offers } = await db
      .from("supplier_offers")
      .select("id, supplier_sku, cost, currency, availability, lead_time_days, part:parts!supplier_offers_part_id_fkey(name)")
      .eq("supplier_id", sup.id)
      .eq("active", true)
      .not("supplier_sku", "is", null)
      .order("last_checked_at", { ascending: true, nullsFirst: true })
      .limit(cfg.maxPerRun);
    type Row = {
      id: string;
      supplier_sku: string;
      cost: number | null;
      currency: string;
      availability: string;
      lead_time_days: number | null;
      part: { name: string } | null;
    };
    const rows = (offers ?? []) as unknown as Row[];

    const { data: run } = await db.from("supplier_sync_runs").insert({ supplier_code: code, trigger, status: "running" }).select("id").single();
    let requests = 0;
    let checked = 0;
    let changedOffers = 0;
    const missing: { partName: string; sku: string }[] = [];
    const changes: Change[] = [];
    let status: "ok" | "blocked" | "failed" = "ok";
    let error: string | null = null;

    for (const o of rows) {
      if (Date.now() - started > TIME_BUDGET_MS) break; // the rest go first tomorrow (oldest-checked first)
      if (requests) await sleep(cfg.gapMs);
      requests++;
      let r: SupplierProduct | null;
      try {
        r = await cfg.lookup(o.supplier_sku);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "failed";
        // A rate limit or refusal stops this supplier for today; never retry around it.
        if (/rate_limited|_403|_401/.test(msg)) {
          status = "blocked";
          error = msg;
          break;
        }
        missing.push({ partName: o.part?.name ?? "", sku: o.supplier_sku });
        continue;
      }
      if (!r) {
        missing.push({ partName: o.part?.name ?? "", sku: o.supplier_sku });
        continue;
      }
      checked++;
      const next = { cost: r.cost, currency: r.currency, availability: r.availability, lead_time_days: r.leadTimeDays };
      const diff = (Object.keys(next) as (keyof typeof next)[]).filter((k) => String(o[k] ?? "") !== String(next[k] ?? ""));
      await db.from("supplier_offers").update({ ...next, last_checked_at: new Date().toISOString() }).eq("id", o.id);
      if (diff.length) {
        changedOffers++;
        for (const k of diff) changes.push({ partName: o.part?.name ?? "", sku: o.supplier_sku, field: k, from: o[k], to: next[k] });
      }
    }

    if (run?.id) {
      await db
        .from("supplier_sync_runs")
        .update({
          status,
          error,
          requests,
          checked,
          changed: changedOffers,
          missing: missing.length,
          changes: [...changes, ...missing.map((m) => ({ ...m, missing: true }))],
          finished_at: new Date().toISOString(),
        })
        .eq("id", run.id);
    }
    allChanges.push(...changes.map((c) => ({ ...c, supplier: code })));
    summary[code] = { status, requests, checked, changed: changedOffers, missing: missing.length, error };
    if (status === "blocked") {
      await sendEmail({
        to: [OWNER_EMAIL],
        subject: `${code === "mouser" ? "Mouser" : "DigiKey"} refresh stopped`,
        html: `<p>The daily refresh stopped (${escapeHtml(error ?? "")}) after ${requests} lookups and didn't retry. Offers not reached keep their last numbers and go first tomorrow.</p>`,
      });
    }
  }

  if (allChanges.length) {
    const rows = allChanges
      .map(
        (c) =>
          `<tr><td>${c.supplier === "mouser" ? "Mouser" : "DigiKey"}</td><td>${escapeHtml(c.partName)}</td><td>${escapeHtml(c.sku)}</td><td>${escapeHtml(
            c.field.replace(/_/g, " ")
          )}</td><td>${escapeHtml(String(c.from ?? "—"))} → <b>${escapeHtml(String(c.to ?? "—"))}</b></td></tr>`
      )
      .join("");
    await sendEmail({
      to: [OWNER_EMAIL],
      subject: `Mouser/DigiKey refresh: ${allChanges.length} change(s)`,
      html: `<table cellpadding="4" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px"><tr><th align="left">Supplier</th><th align="left">Product</th><th align="left">Their SKU</th><th align="left">What</th><th align="left">Change</th></tr>${rows}</table><p>Applied automatically. Products below your margin floor show a red ⚠ in Dashboard → Store.</p>`,
    });
  }
  return summary;
}
