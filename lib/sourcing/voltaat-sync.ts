// Server-only: the daily Voltaat price sync (Task 19g). Called by the cron
// route (daily) or the admin "Run now" button. Uses the service client — the
// cron has no user session.
//
// Order of checks: switch off → skip; a finished run in the last 20 h → skip
// (one run a day); robots.txt must allow the feed; then read the catalogue
// once, compare with every mapped Voltaat offer, and write numbers only.
// A 403/429 stops everything, keeps the last known prices and emails the
// owner. Every run is logged in supplier_sync_runs, and when anything moved
// the owner gets the change report.
//
// A mapped product that Voltaat no longer lists is marked "order on request"
// (offer inactive → lead_time_class null) the first time it goes missing and
// reported once; it is not nagged about again. If it comes back, the normal
// change path re-activates it.

import type { SupabaseClient } from "@supabase/supabase-js";

import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import { dataTable } from "@/lib/email/brand-layout";
import {
  BlockedError,
  planChanges,
  robotsAllows,
  VOLTAAT_IN_STOCK_DAYS,
  VoltaatClient,
  type DroppedOffer,
  type MappedOffer,
  type MissingOffer,
  type OfferChange,
} from "@/lib/sourcing/adapters/voltaat";

export type SyncSummary = {
  status: "ok" | "blocked" | "failed" | "disabled" | "skipped";
  runId?: string;
  requests: number;
  checked: number;
  changed: number;
  /** Mapped products whose link/option can't be followed (owner to re-map). */
  missing: number;
  /** Products newly marked "order on request" this run because Voltaat dropped them. */
  dropped: number;
  error?: string;
};

const MIN_HOURS_BETWEEN_RUNS = 20;

export async function voltaatSyncEnabled(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from("store_settings").select("value").eq("key", "voltaat_sync").maybeSingle();
  return (data?.value as { enabled?: boolean } | null)?.enabled !== false;
}

export async function runVoltaatSync(db: SupabaseClient, trigger: "cron" | "manual"): Promise<SyncSummary> {
  const empty = { requests: 0, checked: 0, changed: 0, missing: 0, dropped: 0 };

  if (!(await voltaatSyncEnabled(db))) {
    await db.from("supplier_sync_runs").insert({ supplier_code: "voltaat", trigger, status: "disabled", finished_at: new Date().toISOString() });
    return { status: "disabled", ...empty };
  }

  const since = new Date(Date.now() - MIN_HOURS_BETWEEN_RUNS * 3600_000).toISOString();
  const { data: recent } = await db
    .from("supplier_sync_runs")
    .select("id")
    .eq("supplier_code", "voltaat")
    .eq("status", "ok")
    .gte("started_at", since)
    .limit(1);
  if (recent?.length) return { status: "skipped", ...empty, error: "already_ran_today" };

  const { data: run } = await db
    .from("supplier_sync_runs")
    .insert({ supplier_code: "voltaat", trigger, status: "running" })
    .select("id")
    .single();
  const runId = run?.id as string | undefined;

  const client = new VoltaatClient();
  const finish = async (patch: Record<string, unknown>) => {
    if (runId)
      await db
        .from("supplier_sync_runs")
        .update({ ...patch, requests: client.requests, finished_at: new Date().toISOString() })
        .eq("id", runId);
  };

  try {
    // Mapped offers: Voltaat offers with a product link (in or out of stock). Nothing else is touched.
    const { data: sup } = await db.from("suppliers").select("id").eq("code", "voltaat").single();
    const { data: rows } = await db
      .from("supplier_offers")
      .select("id, part_id, supplier_sku, supplier_url, retail_price, availability, lead_time_days, active, part:parts!supplier_offers_part_id_fkey(name, unit_price)")
      .eq("supplier_id", sup!.id)
      .not("supplier_url", "is", null);
    type Row = Omit<MappedOffer, "part_name" | "our_price"> & { part: { name: string; unit_price: number } | null };
    const offers: MappedOffer[] = ((rows ?? []) as unknown as Row[]).map((r) => ({
      ...r,
      part_name: r.part?.name ?? "",
      our_price: Number(r.part?.unit_price ?? 0),
    }));

    if (!offers.length) {
      await finish({ status: "ok", checked: 0, changed: 0, missing: 0 });
      return { status: "ok", runId, ...empty };
    }

    const robots = await client.robots();
    if (!robotsAllows(robots, "/products.json?limit=250&page=1")) {
      await finish({ status: "blocked", error: "robots_disallow" });
      await alert("Voltaat's robots.txt no longer allows reading its catalogue. The sync stopped and kept the last known prices.");
      return { status: "blocked", runId, ...empty, requests: client.requests, error: "robots_disallow" };
    }

    const catalogue = await client.catalogue();
    const plan = planChanges(offers, catalogue);

    const now = new Date().toISOString();
    for (const c of plan.changes) {
      await db
        .from("supplier_offers")
        .update({
          retail_price: c.newRetail,
          currency: "QAR",
          availability: c.newAvailability,
          // Out of stock at Voltaat → offer inactive → "available on request"; back in stock → active again.
          active: c.newAvailability === "in_stock",
          ...(c.newAvailability === "in_stock" ? { lead_time_days: VOLTAAT_IN_STOCK_DAYS } : {}),
          last_checked_at: now,
        })
        .eq("id", c.offerId);
    }
    // Dropped from Voltaat's list → "order on request": the offer goes inactive, so the
    // 0028 trigger clears the product's lead_time_class. Price and link are kept, so a
    // product that comes back is picked up by the change path above and re-activated.
    const newlyDropped = plan.dropped.filter((d) => !d.alreadyOnRequest);
    for (const d of newlyDropped) {
      await db
        .from("supplier_offers")
        .update({ active: false, availability: "unavailable", last_checked_at: now })
        .eq("id", d.offerId);
    }
    const touched = new Set([...plan.changes.map((c) => c.offerId), ...plan.missing.map((m) => m.offerId), ...newlyDropped.map((d) => d.offerId)]);
    const unchangedIds = offers.filter((o) => !touched.has(o.id)).map((o) => o.id);
    for (let i = 0; i < unchangedIds.length; i += 200) {
      await db.from("supplier_offers").update({ last_checked_at: now }).in("id", unchangedIds.slice(i, i + 200));
    }

    // Our price after the trigger re-derived it (mirror products follow at once).
    const partIds = [...new Set(plan.changes.map((c) => c.partId))];
    const { data: after } = partIds.length
      ? await db.from("parts").select("id, unit_price").in("id", partIds)
      : { data: [] };
    const priceNow = new Map((after ?? []).map((p) => [p.id as string, Number(p.unit_price)]));
    const changes = plan.changes.map((c) => ({ ...c, newOurPrice: priceNow.get(c.partId) ?? null }));

    const stillOnRequest = plan.dropped.length - newlyDropped.length;
    await finish({
      status: "ok",
      checked: plan.checked,
      changed: changes.length,
      missing: plan.missing.length,
      changes: [
        ...changes,
        ...newlyDropped.map((d) => ({ offerId: d.offerId, partId: d.partId, partName: d.partName, dropped: true })),
        ...plan.missing.map((m) => ({ ...m, missing: true })),
      ],
    });
    if (changes.length || newlyDropped.length || plan.missing.length) await report(changes, newlyDropped, stillOnRequest, plan.missing);
    return {
      status: "ok",
      runId,
      requests: client.requests,
      checked: plan.checked,
      changed: changes.length,
      missing: plan.missing.length,
      dropped: newlyDropped.length,
    };
  } catch (e) {
    if (e instanceof BlockedError) {
      await finish({ status: "blocked", error: e.message });
      await alert(
        `Voltaat answered ${e.status} (${e.status === 429 ? "too many requests" : "forbidden"}). The sync stopped at once, did not retry, and kept the last known prices.`
      );
      return { status: "blocked", runId, ...empty, requests: client.requests, error: e.message };
    }
    const msg = e instanceof Error ? e.message : "failed";
    await finish({ status: "failed", error: msg });
    await alert(`The Voltaat price sync failed (${msg}). Prices were not changed.`);
    return { status: "failed", runId, ...empty, requests: client.requests, error: msg };
  }
}

async function alert(text: string) {
  await sendEmail({
    to: [OWNER_EMAIL],
    subject: "Voltaat price sync stopped",
    ...renderOwnerEmail({
      title: "Voltaat price sync stopped",
      paragraphs: [text, "See Dashboard → Suppliers → Voltaat sync. You can switch the sync off there."],
    }),
  });
}

async function report(
  changes: (OfferChange & { newOurPrice: number | null })[],
  dropped: DroppedOffer[],
  stillOnRequest: number,
  missing: MissingOffer[]
) {
  const q = (n: number | null) => (n === null ? "—" : `QAR ${n.toFixed(2)}`);
  const table = dataTable(
    ["Product", "Voltaat price", "Availability", "Our price now"],
    changes.map((c) => {
      const pct = c.oldRetail ? ((c.newRetail - c.oldRetail) / c.oldRetail) * 100 : null;
      return [
        c.partName,
        `${q(c.oldRetail)} → ${q(c.newRetail)}${pct === null ? "" : ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`}`,
        c.oldAvailability === c.newAvailability ? "" : `${c.oldAvailability} → ${c.newAvailability}`,
        q(c.newOurPrice),
      ];
    })
  );
  const paragraphs: string[] = [];
  if (dropped.length)
    paragraphs.push(
      `${dropped.length} product(s) are no longer on Voltaat's list and now show "order on request": ${dropped
        .slice(0, 20)
        .map((d) => d.partName)
        .join(", ")}${dropped.length > 20 ? ", …" : ""}. If one comes back on Voltaat it switches back on its own.`
    );
  if (stillOnRequest) paragraphs.push(`${stillOnRequest} other product(s) stay "order on request" (still off Voltaat's list).`);
  if (missing.length)
    paragraphs.push(
      `${missing.length} mapped product(s) couldn't be followed — re-map them on Dashboard → Suppliers → Voltaat sync: ${missing
        .slice(0, 20)
        .map((m) => `${m.partName} (${m.reason.replace(/_/g, " ")})`)
        .join(", ")}`
    );
  const mail = renderOwnerEmail({
    title: `Voltaat prices: ${changes.length} change(s) today`,
    bodyHtml: table.html,
    bodyText: table.text,
    paragraphs,
  });
  await sendEmail({
    to: [OWNER_EMAIL],
    subject: `Voltaat prices: ${changes.length} change(s) today`,
    html: mail.html,
    text: mail.text,
  });
}
