// The scheduled jobs, one definition each, shared by the Vercel cron routes
// (app/api/cron/*/route.ts via lib/cron/route.ts) and the Mac Mini worker
// (services/worker/src/jobs.ts). Each `run` is the route's former body after
// its auth check and returns that route's exact status + JSON body. No next/*
// anywhere below this file: the caller supplies the cache purge and the
// contact-number loader (CronDeps).
//
// Schedules: `utc` is the vercel.json schedule (the two CAD Champions crons
// are not in vercel.json; theirs is the one docs/cad-champions/DEPLOY.md and
// TRAINING.md give). `qatar` is the same moment in Asia/Qatar (UTC+3 all
// year, no daylight saving), which is how the worker schedules it.

import { catalogTagsFor } from "@/lib/cache/catalog-tags";
import { runMonitoringAlerts } from "@/lib/cad-champions/monitoring/alerts-server";
import { runPaymentsCron } from "@/lib/cad-champions/payments/server";
import { sendWeeklyProgressEmails } from "@/lib/cad-champions/training/weekly-email";
import { runRetirementsWith } from "@/lib/integrations/youtube-retire-core";
import { drainOutboxWith } from "@/lib/notifications/drain-core";
import { runApiRefresh } from "@/lib/sourcing/api-refresh";
import { runVoltaatSync } from "@/lib/sourcing/voltaat-sync";

import { runAnonymousCleanup } from "./anonymous-cleanup";
import { runDeliveryPromiseReview } from "./delivery-promises";
import type { CronDeps, CronOutcome } from "./types";

export type { CronDeps, CronOutcome } from "./types";

export const CRON_JOB_NAMES = [
  "supplier-refresh",
  "voltaat-sync",
  "delivery-promises",
  "notifications",
  "anonymous-cleanup",
  "youtube-retire",
  "cc-payments-expire",
  "cc-weekly-progress",
] as const;
export type CronJobName = (typeof CRON_JOB_NAMES)[number];

export type CronJob = {
  name: CronJobName;
  /** UTC cron expression: vercel.json, or the documented one for the two CC crons. */
  utc: string;
  /** In vercel.json today. */
  inVercelJson: boolean;
  /** The same moment in Asia/Qatar (UTC+3): what the worker schedules. */
  qatar: string;
  run: (deps: CronDeps) => Promise<CronOutcome>;
};

/** The storefront tags youtube-retire purges after changing the site links (= revalidateStorefront()). */
export const STOREFRONT_ALL_TAGS = ["parts", "store-settings"] as const;
/** Notification outbox rows per run (was BATCH in the route). */
export const NOTIFICATION_BATCH = 50;

const noServiceKey: CronOutcome = { status: 500, body: { error: "no_service_key" } };

async function purgeChange(deps: CronDeps, change: Parameters<typeof catalogTagsFor>[0]): Promise<string[]> {
  // Same as revalidateCatalogChange(): compute the tags, purge only when there are some.
  const tags = catalogTagsFor(change);
  if (tags.length) await deps.purge(tags);
  return tags;
}

export const CRON_JOBS: Readonly<Record<CronJobName, CronJob>> = {
  // Daily Mouser + DigiKey refresh.
  "supplier-refresh": {
    name: "supplier-refresh",
    utc: "0 2 * * *",
    inVercelJson: true,
    qatar: "0 5 * * *",
    async run(deps) {
      const db = deps.db();
      if (!db) return noServiceKey;
      const result = await runApiRefresh(db, "cron");
      // Purge only what moved, per product (see voltaat-sync).
      const purged = await purgeChange(deps, result.storefront);
      return { status: 200, body: { ...result, purged } };
    },
  },
  // Daily Voltaat price sync.
  "voltaat-sync": {
    name: "voltaat-sync",
    utc: "0 3 * * *",
    inVercelJson: true,
    qatar: "0 6 * * *",
    async run(deps) {
      const db = deps.db();
      if (!db) return noServiceKey;
      const result = await runVoltaatSync(db, "cron");
      // Purge only what moved: "part-<sku>" per product whose offer changed,
      // "parts-listing" only when a listed field moved, one full "parts" purge past
      // the cap (lib/cache/catalog-tags.ts). A whole-store purge re-rendered ~2,600
      // product pages (Vercel ISR writes). Unchanged pages still expire on their
      // own after 24 h (STOREFRONT_REVALIDATE).
      const purged = await purgeChange(deps, result.storefront);
      return { status: 200, body: { ...result, purged } };
    },
  },
  "delivery-promises": {
    name: "delivery-promises",
    utc: "0 4 * * *",
    inVercelJson: true,
    qatar: "0 7 * * *",
    async run(deps) {
      const db = deps.db();
      if (!db) return noServiceKey;
      return { status: 200, body: await runDeliveryPromiseReview(db) };
    },
  },
  // Drains notification_outbox (0046); rules in lib/notifications/drain-core.ts.
  notifications: {
    name: "notifications",
    utc: "30 4 * * *",
    inVercelJson: true,
    qatar: "30 7 * * *",
    async run(deps) {
      const db = deps.db();
      if (!db) return noServiceKey;
      const result = await drainOutboxWith(db, deps.siteUrl, NOTIFICATION_BATCH, deps.refreshContactPhone);
      if (!result.ok) return { status: 500, body: { error: result.error, detail: result.detail } };
      return { status: 200, body: result.summary };
    },
  },
  // Weekly, Sunday.
  "anonymous-cleanup": {
    name: "anonymous-cleanup",
    utc: "0 5 * * 0",
    inVercelJson: true,
    qatar: "0 8 * * 0",
    async run(deps) {
      const db = deps.db();
      if (!db) return noServiceKey;
      return runAnonymousCleanup(db);
    },
  },
  // 07:00 UTC = 10:00 Qatar, right after Google resets the YouTube quota.
  "youtube-retire": {
    name: "youtube-retire",
    utc: "0 7 * * *",
    inVercelJson: true,
    qatar: "0 10 * * *",
    async run(deps) {
      const result = await runRetirementsWith({}, () => deps.purge(STOREFRONT_ALL_TAGS));
      return { status: 200, body: result };
    },
  },
  // CAD Champions payments: expiry, reminders, enrollment end, then the monitoring check.
  "cc-payments-expire": {
    name: "cc-payments-expire",
    utc: "0 * * * *",
    inVercelJson: false,
    qatar: "0 * * * *",
    async run() {
      const result = await runPaymentsCron();
      // The alert check never blocks or fails the payments run.
      const monitoring = await runMonitoringAlerts();
      console.log("[cc-monitor] run:", JSON.stringify(monitoring));
      if ("error" in result) {
        console.error("[cc-payments-cron] run failed:", result.error);
        return { status: 500, body: { ...result, monitoring } };
      }
      console.log("[cc-payments-cron] run:", JSON.stringify(result));
      return { status: 200, body: { ...result, monitoring } };
    },
  },
  // Weekly CAD Champions training progress email (Sunday).
  "cc-weekly-progress": {
    name: "cc-weekly-progress",
    utc: "0 6 * * 0",
    inVercelJson: false,
    qatar: "0 9 * * 0",
    async run() {
      const result = await sendWeeklyProgressEmails();
      if ("error" in result) {
        console.error("[cc-weekly] run failed:", result.error);
        return { status: 500, body: result };
      }
      console.log("[cc-weekly] run:", JSON.stringify(result));
      return { status: 200, body: result };
    },
  },
};
