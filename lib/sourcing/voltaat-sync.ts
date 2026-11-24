// Server-only: the Voltaat price sync (Task 19g). Called by the cron route or
// the admin "Run now" button. Uses the service client — the cron has no user
// session.
//
// ONE REQUEST PER BATCH (2026-11-24). Voltaat's store refuses a second request
// that follows the first by a few seconds (429, Retry-After: 60), so the sync
// no longer reads the catalogue in one go. A schedule calls this about once an
// hour and each call makes exactly one request: robots.txt first, then one
// catalogue page (250 products) per batch until a page comes back short. That
// is one pass a day, ~8 requests, spread over ~8 hours. Where the pass is
// lives in store_settings (lib/sourcing/voltaat-pass.ts).
//
// Order of checks: switch off → skip; another runner mid-batch, a batch less
// than 40 minutes ago, or an unexpired block → skip (voltaat-block.ts
// runGuard, which reads supplier_sync_runs and so covers every runner);
// today's pass already finished → skip. None of these makes a request.
// A 403/429 stops the batch and keeps the last known prices; the pass stays on
// the same page and the wait before the next try grows with every blocked
// batch in a row. The owner gets ONE email once whole days have gone by
// blocked (BLOCKED_DAYS_BEFORE_EMAIL), not one per blocked batch.
// Every batch is logged in supplier_sync_runs. What moved is emailed once,
// when the pass ends — not once per batch.
//
// Where it runs: the Mac that serves the site (launchd, hourly) or the Mac
// Mini worker. It is not in vercel.json; see docs/WORKER.md.
//
// A mapped product that Voltaat no longer lists is marked "order on request"
// (offer inactive → lead_time_class null) once neither this pass nor the
// previous one saw it, and reported once; it is not nagged about again. If it
// comes back, the normal change path re-activates it.

import type { DbClient, Json } from "@/lib/supabase/db";

import { OWNER_EMAIL, sendEmail } from "@/lib/email";
import { renderOwnerEmail } from "@/lib/email/lead-email";
import { dataTable } from "@/lib/email/brand-layout";
import {
  BlockedError,
  handleFromUrl,
  MAX_PAGES,
  PAGE_SIZE,
  planPage,
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
import { afterPage, afterRobots, droppedAfterPass, nextStep, parsePassState, PASS_STATE_KEY, type PassState } from "@/lib/sourcing/voltaat-pass";

export type SyncSummary = {
  status: "ok" | "blocked" | "failed" | "disabled" | "skipped";
  runId?: string;
  /** What this batch read: "robots", or "page_3". Absent when nothing was requested. */
  step?: string;
  /** True on the batch that read the last catalogue page. */
  passDone?: boolean;
  requests: number;
  checked: number;
  changed: number;
  /** Mapped products whose link/option can't be followed (owner to re-map). */
  missing: number;
  /** Products newly marked "order on request" this batch because Voltaat dropped them. */
  dropped: number;
  /**
   * What the storefront must refresh (lib/cache/catalog-tags.ts): the SKUs of
   * the products whose offer this batch changed or dropped, and whether a field
   * a listing shows moved. Empty when nothing was written.
   */
  storefront: CatalogChange;
  error?: string;
};

const NO_CHANGE: CatalogChange = { skus: [], listingChanged: false };
const UNKNOWN_CHANGE: CatalogChange = { skus: [], listingChanged: true, unknown: true };

/** "Run now" may follow another batch sooner than the schedule, but never inside the store's 60 s. */
const MANUAL_MIN_MINUTES = 3;
/** How far back the guard and the blocked-day streak look. */
const RUN_HISTORY_DAYS = 14;

type HistoryRun = RecentRun & { checked?: number | null };
type OurChange = OfferChange & { newOurPrice: number | null };
type OfferRow = MappedOffer & { last_checked_at: string | null; created_at: string };

const utcDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

/**
 * Days in a row on which the store blocked us and no batch got any prices,
 * counting this batch's block (which is not in `history` yet). A day on which
 * a later batch got through is not a blocked day.
 */
function blockedStreak(history: readonly HistoryRun[], now: Date): number {
  const goodDays = new Set(history.filter((r) => r.status === "ok" && (r.checked ?? 0) > 0).map((r) => utcDay(r.started_at)));
  const blocked = [...history.filter((r) => r.status === "blocked").map((r) => r.started_at), now.toISOString()];
  return blockedDayStreak(
    blocked.filter((iso) => !goodDays.has(utcDay(iso))),
    now
  );
}

/** One email per streak: only the first blocked batch of the day that completes it. */
function emailBlockedNow(history: readonly HistoryRun[], now: Date): boolean {
  const today = utcDay(now.toISOString());
  if (history.some((r) => r.status === "blocked" && utcDay(r.started_at) === today)) return false;
  return shouldEmailBlocked(blockedStreak(history, now));
}

export async function voltaatSyncEnabled(db: DbClient): Promise<boolean> {
  const { data } = await db.from("store_settings").select("value").eq("key", "voltaat_sync").maybeSingle();
  return (data?.value as { enabled?: boolean } | null)?.enabled !== false;
}

async function loadPass(db: DbClient): Promise<PassState | null> {
  const { data } = await db.from("store_settings").select("value").eq("key", PASS_STATE_KEY).maybeSingle();
  return parsePassState(data?.value);
}

async function savePass(db: DbClient, state: PassState) {
  const { error } = await db
    .from("store_settings")
    .upsert({ key: PASS_STATE_KEY, value: state as unknown as Json, updated_at: new Date().toISOString() });
  if (error) throw new Error(`pass_state_${error.code ?? "write"}`);
}

/** Every mapped Voltaat offer (a product link, in or out of stock). Nothing else is touched. */
async function mappedOffers(db: DbClient): Promise<OfferRow[]> {
  const { data: sup } = await db.from("suppliers").select("id").eq("code", "voltaat").single();
  const out: OfferRow[] = [];
  const STEP = 1000; // PostgREST returns at most 1000 rows per request
  for (let from = 0; ; from += STEP) {
    const { data: rows, error } = await db
      .from("supplier_offers")
      .select(
        "id, part_id, supplier_sku, supplier_url, retail_price, availability, lead_time_days, active, last_checked_at, created_at, part:parts!supplier_offers_part_id_fkey(name, unit_price)"
      )
      .eq("supplier_id", sup!.id)
      .not("supplier_url", "is", null)
      .order("id")
      .range(from, from + STEP - 1);
    if (error) throw new Error(`offers_${error.code ?? "read"}`);
    for (const r of rows ?? []) out.push({ ...r, part_name: r.part?.name ?? "", our_price: Number(r.part?.unit_price ?? 0) });
    if ((rows ?? []).length < STEP) break;
  }
  return out;
}

/** What the batches of one pass logged, flattened back into the three lists the report shows. */
async function passChanges(db: DbClient, since: string) {
  const { data } = await db
    .from("supplier_sync_runs")
    .select("changes")
    .eq("supplier_code", "voltaat")
    .eq("status", "ok")
    .gte("started_at", since)
    .order("started_at", { ascending: true })
    .limit(200);
  const changes: OurChange[] = [];
  const dropped: DroppedOffer[] = [];
  const missing: MissingOffer[] = [];
  for (const row of data ?? []) {
    for (const c of (Array.isArray(row.changes) ? row.changes : []) as Record<string, unknown>[]) {
      if (c.dropped) dropped.push({ offerId: String(c.offerId), partId: String(c.partId), partName: String(c.partName ?? ""), alreadyOnRequest: false });
      else if (c.missing) missing.push({ offerId: String(c.offerId), partName: String(c.partName ?? ""), reason: c.reason === "no_handle" ? "no_handle" : "variant_unclear" });
      else if (typeof c.newRetail === "number") changes.push(c as unknown as OurChange);
    }
  }
  return { changes, dropped, missing };
}

export async function runVoltaatSync(db: DbClient, trigger: "cron" | "manual"): Promise<SyncSummary> {
  const empty = { requests: 0, checked: 0, changed: 0, missing: 0, dropped: 0, storefront: NO_CHANGE };

  if (!(await voltaatSyncEnabled(db))) {
    // The schedule calls hourly: log "disabled" once a day, not 24 times.
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const { data: logged } = await db
      .from("supplier_sync_runs")
      .select("id")
      .eq("supplier_code", "voltaat")
      .eq("status", "disabled")
      .gte("started_at", dayAgo)
      .limit(1);
    if (!logged?.length)
      await db.from("supplier_sync_runs").insert({ supplier_code: "voltaat", trigger, status: "disabled", finished_at: new Date().toISOString() });
    return { status: "disabled", ...empty };
  }

  // One guard for EVERY runner (they share this table): another batch in
  // flight, a batch too recently, or a block whose wait is not over all mean
  // "not now". lib/sourcing/voltaat-block.ts.
  const startedAt = new Date();
  const { data: recentRuns } = await db
    .from("supplier_sync_runs")
    .select("id, status, started_at, error, checked")
    .eq("supplier_code", "voltaat")
    .gte("started_at", new Date(startedAt.getTime() - RUN_HISTORY_DAYS * 86_400_000).toISOString())
    .order("started_at", { ascending: false })
    .limit(400);
  const history: HistoryRun[] = (recentRuns ?? []) as HistoryRun[];
  const guard = trigger === "manual" ? runGuard(history, startedAt, MANUAL_MIN_MINUTES) : runGuard(history, startedAt);
  if (guard.skip) {
    if (guard.reason === "blocked_until") console.warn(`[voltaat-sync] still blocked, next try after ${guard.until}`);
    return { status: "skipped", ...empty, error: guard.reason };
  }

  // Where the pass is: robots.txt, a catalogue page, or finished for today.
  const step = nextStep(await loadPass(db), startedAt, trigger);
  if (step.kind === "skip") return { status: "skipped", ...empty, error: step.reason };
  const stepName = step.kind === "robots" ? "robots" : `page_${step.page}`;

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
    const offers = await mappedOffers(db);

    if (!offers.length) {
      await finish({ status: "ok", checked: 0, changed: 0, missing: 0 });
      // Nothing is mapped: nothing to ask Voltaat for today.
      await savePass(db, { ...step.state, done: true, completedAt: new Date().toISOString() });
      return { status: "ok", runId, step: stepName, passDone: true, ...empty };
    }

    // ── Batch 0: robots.txt, the only request of this batch ────────────────
    if (step.kind === "robots") {
      const robots = await client.robots();
      if (!robotsAllows(robots, `/products.json?limit=${PAGE_SIZE}&page=1`)) {
        await finish({ status: "blocked", error: "robots_disallow" });
        // Same rule as a 403/429: one email once the block has lasted days.
        if (emailBlockedNow(history, startedAt))
          await alert(
            `Voltaat's robots.txt has not allowed reading its catalogue for ${BLOCKED_DAYS_BEFORE_EMAIL} days. The sync stopped each time and kept the last known prices.`
          );
        return { status: "blocked", runId, step: stepName, ...empty, requests: client.requests, error: "robots_disallow" };
      }
      await finish({ status: "ok", checked: 0, changed: 0, missing: 0 });
      await savePass(db, afterRobots(step.state));
      return { status: "ok", runId, step: stepName, passDone: false, ...empty, requests: client.requests };
    }

    // ── Batch 1..n: one catalogue page, the only request of this batch ─────
    const { products, count } = await client.page(step.page);
    const plan = planPage(offers, products);
    const next = afterPage(step.state, step.page, count, PAGE_SIZE, MAX_PAGES, new Date());

    const now = new Date().toISOString();
    const seen = new Set(plan.seen);

    // The pass ends on this page: who did neither this pass nor the last one see?
    const noHandle: MissingOffer[] = [];
    let newlyDropped: DroppedOffer[] = [];
    let stillOnRequest = 0;
    if (next.done) {
      for (const o of offers) if (!handleFromUrl(o.supplier_url)) noHandle.push({ offerId: o.id, partName: o.part_name, reason: "no_handle" });
      const gone = droppedAfterPass(
        offers.map((o) => ({
          id: o.id,
          hasHandle: !!handleFromUrl(o.supplier_url),
          // Seen on this very page counts as seen now; never checked falls back to when it was mapped.
          last_checked_at: seen.has(o.id) ? now : (o.last_checked_at ?? o.created_at),
        })),
        next
      );
      const byId = new Map(offers.map((o) => [o.id, o]));
      const all = gone.map((g) => byId.get(g.id)!).map((o) => ({ offerId: o.id, partId: o.part_id, partName: o.part_name, alreadyOnRequest: o.active === false }));
      newlyDropped = all.filter((d) => !d.alreadyOnRequest);
      stillOnRequest = all.length - newlyDropped.length;
    }

    // Products whose offer this batch writes (a "missing" offer is not written).
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
      await db.from("supplier_offers").update({ active: false, availability: "unavailable" }).eq("id", d.offerId);
    }
    // Everything else found on this page was seen today (that is what the
    // end-of-pass "dropped" check reads), whether or not its numbers moved.
    const changedIds = new Set(plan.changes.map((c) => c.offerId));
    const seenUnchanged = plan.seen.filter((id) => !changedIds.has(id));
    for (let i = 0; i < seenUnchanged.length; i += 200) {
      await db.from("supplier_offers").update({ last_checked_at: now }).in("id", seenUnchanged.slice(i, i + 200));
    }

    // Our price after the trigger re-derived it (mirror products follow at once).
    const partIds = [...new Set(plan.changes.map((c) => c.partId))];
    const { data: after } = partIds.length ? await db.from("parts").select("id, unit_price").in("id", partIds) : { data: [] };
    const priceNow = new Map((after ?? []).map((p) => [p.id as string, Number(p.unit_price)]));
    const changes: OurChange[] = plan.changes.map((c) => ({ ...c, newOurPrice: priceNow.get(c.partId) ?? null }));
    // The 0028 trigger has re-derived price / lead class by now: compare.
    const storefront = touchedPartIds.length ? diffPartSnapshots(touchedPartIds, before, await snapshotParts(db, touchedPartIds)) : NO_CHANGE;

    const missing = [...plan.missing, ...noHandle];
    await finish({
      status: "ok",
      checked: plan.checked,
      changed: changes.length,
      missing: missing.length,
      changes: [
        ...changes,
        ...newlyDropped.map((d) => ({ offerId: d.offerId, partId: d.partId, partName: d.partName, dropped: true })),
        ...missing.map((m) => ({ ...m, missing: true })),
      ],
    });
    // Only now move on: had anything above thrown, the next batch re-reads this page.
    await savePass(db, next);

    if (next.done) {
      // ONE email for the whole pass, from what its batches logged.
      const all = await passChanges(db, step.state.startedAt);
      if (all.changes.length || all.dropped.length || all.missing.length) await report(all.changes, all.dropped, stillOnRequest, all.missing);
    }
    return {
      status: "ok",
      runId,
      step: stepName,
      passDone: next.done,
      requests: client.requests,
      checked: plan.checked,
      changed: changes.length,
      missing: missing.length,
      dropped: newlyDropped.length,
      storefront,
    };
  } catch (e) {
    if (e instanceof BlockedError) {
      // Record what the store said we may try again: the next batch reads it
      // from this row and skips until then (runGuard). The pass stays on the
      // same page.
      const retryAfter = e.retryAfter;
      const error = blockErrorText(e.message, retryAfter);
      await finish({ status: "blocked", error });
      if (emailBlockedNow(history, startedAt))
        await alert(
          `Voltaat has answered ${e.status} (${e.status === 429 ? "too many requests" : "forbidden"}) on ${BLOCKED_DAYS_BEFORE_EMAIL} days in a row, and no batch got through on any of them. ` +
            `The sync makes one request an hour, stops at once when refused, waits longer after each refusal, and keeps the last known prices. ` +
            `It is worth asking Voltaat whether they have changed something or would rather we read prices another way.`
        );
      else console.warn(`[voltaat-sync] ${stepName} blocked (${e.message}); no email${retryAfter ? `, store says retry after ${retryAfter}` : ""}`);
      return { status: "blocked", runId, step: stepName, ...empty, storefront: wrote ? UNKNOWN_CHANGE : NO_CHANGE, requests: client.requests, error };
    }
    const msg = e instanceof Error ? e.message : "failed";
    await finish({ status: "failed", error: msg });
    // The next batch tries the same step again, so say it once per pass.
    if (!step.state.failAlerted) {
      await alert(`A Voltaat price sync batch failed (${msg}) at ${stepName}. Prices from that batch were not changed; the next batch tries again.`);
      await savePass(db, { ...step.state, failAlerted: true }).catch(() => undefined);
    }
    return { status: "failed", runId, step: stepName, ...empty, storefront: wrote ? UNKNOWN_CHANGE : NO_CHANGE, requests: client.requests, error: msg };
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
