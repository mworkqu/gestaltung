// Server-only: the daily Voltaat price sync (Task 19g). Called by the cron
// route (daily) or the admin "Run now" button. Uses the service client — the
// cron has no user session.
//
// Order of checks: switch off → skip; another runner mid-run, a good run in
// the last 20 h, or an unexpired block → skip (lib/sourcing/voltaat-block.ts
// runGuard, which reads supplier_sync_runs and so covers BOTH runners);
// robots.txt must allow the feed; then read the catalogue once, compare with
// every mapped Voltaat offer, and write numbers only.
// A 403/429 stops everything and keeps the last known prices; the store's
// Retry-After is recorded on the run so the next schedules are skipped until
// it passes, and the owner gets ONE email once the block has lasted
// BLOCKED_DAYS_BEFORE_EMAIL days — not one per blocked run (2026-11).
// Every run is logged in supplier_sync_runs, and when anything moved the owner
// gets the change report.
//
// Where it runs: the Mac Mini worker only (2026-11). It was removed from
// vercel.json because Voltaat's store blocks shared cloud IP addresses; see
// docs/WORKER.md and lib/sourcing/voltaat-block.ts.
//
// A mapped product that Voltaat no longer lists is marked "order on request"
// (offer inactive → lead_time_class null) the first time it goes missing and
// reported once; it is not nagged about again. If it comes back, the normal
// change path re-activates it.

import type { DbClient } from "@/lib/supabase/db";

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
import { diffPartSnapshots, type CatalogChange } from "@/lib/cache/catalog-tags";
import { snapshotParts } from "@/lib/sourcing/catalog-snapshot";
import {
  BLOCKED_DAYS_BEFORE_EMAIL,
  blockedDayStreak,
  blockErrorText,
  runGuard,
  shouldEmailBlocked,
  type RecentRun,
} from "@/lib/sourcing/voltaat-block";

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
  /**
   * What the storefront must refresh (lib/cache/catalog-tags.ts): the SKUs of
   * the products whose offer this run changed or dropped, and whether a field
   * a listing shows moved. Empty when nothing was written.
   */
  storefront: CatalogChange;
  error?: string;
};

const NO_CHANGE: CatalogChange = { skus: [], listingChanged: false };
const UNKNOWN_CHANGE: CatalogChange = { skus: [], listingChanged: true, unknown: true };

const MIN_HOURS_BETWEEN_RUNS = 20;
/** How far back the guard and the blocked-day streak look. */
const RUN_HISTORY_DAYS = 14;

/** Blocked days in a row, counting this run's block (which is not in `history` yet). */
function blockedStreak(history: readonly RecentRun[], now: Date): number {
  const blocked = history.filter((r) => r.status === "blocked").map((r) => r.started_at);
  return blockedDayStreak([...blocked, now.toISOString()], now);
}

export async function voltaatSyncEnabled(db: DbClient): Promise<boolean> {
  const { data } = await db.from("store_settings").select("value").eq("key", "voltaat_sync").maybeSingle();
  return (data?.value as { enabled?: boolean } | null)?.enabled !== false;
}

export async function runVoltaatSync(db: DbClient, trigger: "cron" | "manual"): Promise<SyncSummary> {
  const empty = { requests: 0, checked: 0, changed: 0, missing: 0, dropped: 0, storefront: NO_CHANGE };

  if (!(await voltaatSyncEnabled(db))) {
    await db.from("supplier_sync_runs").insert({ supplier_code: "voltaat", trigger, status: "disabled", finished_at: new Date().toISOString() });
    return { status: "disabled", ...empty };
  }

  // One guard for BOTH runners (Vercel and the Mac Mini worker share this
  // table): another run in flight, a good run inside 20 h, or a block whose
  // wait is not over all mean "not now". lib/sourcing/voltaat-block.ts.
  const startedAt = new Date();
  const { data: recentRuns } = await db
    .from("supplier_sync_runs")
    .select("id, status, started_at, error")
    .eq("supplier_code", "voltaat")
    .gte("started_at", new Date(startedAt.getTime() - RUN_HISTORY_DAYS * 86_400_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(200);
  const history: RecentRun[] = (recentRuns ?? []) as RecentRun[];
  const guard = runGuard(history, startedAt, MIN_HOURS_BETWEEN_RUNS);
  if (guard.skip) {
    if (guard.reason === "blocked_until") console.warn(`[voltaat-sync] still blocked, next try after ${guard.until}`);
    return { status: "skipped", ...empty, error: guard.reason };
  }

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

  let wrote = false;
  try {
    // Mapped offers: Voltaat offers with a product link (in or out of stock). Nothing else is touched.
    const { data: sup } = await db.from("suppliers").select("id").eq("code", "voltaat").single();
    const { data: rows } = await db
      .from("supplier_offers")
      .select("id, part_id, supplier_sku, supplier_url, retail_price, availability, lead_time_days, active, part:parts!supplier_offers_part_id_fkey(name, unit_price)")
      .eq("supplier_id", sup!.id)
      .not("supplier_url", "is", null);
    const offers: MappedOffer[] = (rows ?? []).map((r) => ({
      ...r,
      part_name: r.part?.name ?? "",
      our_price: Number(r.part?.unit_price ?? 0),
    }));

    if (!offers.length) {
      await finish({ status: "ok", checked: 0, changed: 0, missing: 0 });
      return { status: "ok", runId, ...empty };
    }
    // A failure after the first offer write answers with a full purge (the
    // per-product list is not known yet), so nothing stays stale.

    const robots = await client.robots();
    if (!robotsAllows(robots, "/products.json?limit=250&page=1")) {
      await finish({ status: "blocked", error: "robots_disallow" });
      // Same rule as a 403/429: one email once the block has lasted days, not
      // one per blocked run.
      if (shouldEmailBlocked(blockedStreak(history, startedAt)))
        await alert(
          `Voltaat's robots.txt has not allowed reading its catalogue for ${BLOCKED_DAYS_BEFORE_EMAIL} days. The sync stopped each time and kept the last known prices.`
        );
      return { status: "blocked", runId, ...empty, requests: client.requests, error: "robots_disallow" };
    }

    const catalogue = await client.catalogue();
    const plan = planChanges(offers, catalogue);

    const now = new Date().toISOString();
    const newlyDropped = plan.dropped.filter((d) => !d.alreadyOnRequest);
    // Products whose offer this run writes (a "missing" offer is not written).
    const touchedPartIds = [...new Set([...plan.changes.map((c) => c.partId), ...newlyDropped.map((d) => d.partId)])];
    const before = touchedPartIds.length ? await snapshotParts(db, touchedPartIds) : [];
    wrote = touchedPartIds.length > 0;
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
    // The 0028 trigger has re-derived price / lead class by now: compare.
    const storefront = touchedPartIds.length
      ? diffPartSnapshots(touchedPartIds, before, await snapshotParts(db, touchedPartIds))
      : NO_CHANGE;

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
      storefront,
    };
  } catch (e) {
    if (e instanceof BlockedError) {
      // Record what the store said we may try again: the next scheduled run
      // reads it from this row and skips until then (runGuard).
      const retryAfter = e.retryAfter;
      const error = blockErrorText(e.message, retryAfter);
      await finish({ status: "blocked", error });
      const streak = blockedStreak(history, startedAt);
      if (shouldEmailBlocked(streak))
        await alert(
          `Voltaat has answered ${e.status} (${e.status === 429 ? "too many requests" : "forbidden"}) on ${BLOCKED_DAYS_BEFORE_EMAIL} days in a row. ` +
            `The sync stops at once each time, does not retry, and keeps the last known prices. ` +
            `A 429 for one run a day at one request every 5 seconds is almost certainly the store refusing a shared cloud IP address, not our request count: ` +
            `running the sync from the Mac Mini worker (a Qatar line) is the fix.`
        );
      else console.warn(`[voltaat-sync] blocked (${e.message}), day ${streak} of the streak; no email${retryAfter ? `, retry after ${retryAfter}` : ""}`);
      return { status: "blocked", runId, ...empty, storefront: wrote ? UNKNOWN_CHANGE : NO_CHANGE, requests: client.requests, error };
    }
    const msg = e instanceof Error ? e.message : "failed";
    await finish({ status: "failed", error: msg });
    await alert(`The Voltaat price sync failed (${msg}). Prices were not changed.`);
    return { status: "failed", runId, ...empty, storefront: wrote ? UNKNOWN_CHANGE : NO_CHANGE, requests: client.requests, error: msg };
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
