// Server-only: daily refresh of Mouser and DigiKey offers (Task 19e), kept to
// the fewest API calls: an offer is looked up only when its numbers are over
// a week old, oldest first, at most MAX_PER_RUN lookups per supplier per day
// (so a big catalogue is covered in rotation, never in one burst), and paced
// under each API's per-minute limit. Writes
// NUMBERS ONLY (cost, currency, availability, lead time) and applies them
// directly — the owner chose no approval queue. Each supplier's run is
// logged in supplier_sync_runs; the owner is emailed what moved.

import type { SupabaseClient } from "@supabase/supabase-js";

import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import { dataTable } from "@/lib/email/brand-layout";
import { digikeyConfigured, digikeyPart } from "@/lib/sourcing/adapters/digikey";
import { mouserConfigured, mouserPart } from "@/lib/sourcing/adapters/mouser";
import type { SupplierProduct } from "@/lib/sourcing/types";

type Code = "mouser" | "digikey";

const CONFIG: Record<Code, { gapMs: number; maxPerRun: number; lookup: (sku: string) => Promise<SupplierProduct | null>; ready: () => boolean }> = {
  // Mouser: 30 calls/minute, 1,000/day.
  mouser: { gapMs: 2100, maxPerRun: 25, lookup: mouserPart, ready: mouserConfigured },
  // DigiKey: 120 calls/minute on the free tier.
  digikey: { gapMs: 600, maxPerRun: 25, lookup: digikeyPart, ready: digikeyConfigured },
};

const TIME_BUDGET_MS = 250_000; // stay inside the 300 s function limit
const MIN_HOURS_BETWEEN_RUNS = 20;
/** An offer checked more recently than this is left alone. */
const STALE_AFTER_DAYS = 7;
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
      .or(`last_checked_at.is.null,last_checked_at.lt.${new Date(Date.now() - STALE_AFTER_DAYS * 86400_000).toISOString()}`)
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
    if (!rows.length) {
      summary[code] = "nothing_stale";
      continue;
    }

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
        ...renderOwnerEmail({
          title: `${code === "mouser" ? "Mouser" : "DigiKey"} refresh stopped`,
          paragraphs: [
            `The daily refresh stopped (${error ?? ""}) after ${requests} lookups and didn't retry. Offers not reached keep their last numbers and go first tomorrow.`,
          ],
        }),
      });
    }
  }

  if (allChanges.length) {
    const table = dataTable(
      ["Supplier", "Product", "Their SKU", "What", "Change"],
      allChanges.map((c) => [
        c.supplier === "mouser" ? "Mouser" : "DigiKey",
        c.partName,
        c.sku,
        c.field.replace(/_/g, " "),
        `${String(c.from ?? "—")} → ${String(c.to ?? "—")}`,
      ])
    );
    const mail = renderOwnerEmail({
      title: `Mouser/DigiKey refresh: ${allChanges.length} change(s)`,
      bodyHtml: table.html,
      bodyText: table.text,
      paragraphs: ["Applied automatically. Products below your margin floor show a red ⚠ in Dashboard → Store."],
    });
    await sendEmail({
      to: [OWNER_EMAIL],
      subject: `Mouser/DigiKey refresh: ${allChanges.length} change(s)`,
      html: mail.html,
      text: mail.text,
    });
  }
  return summary;
}
