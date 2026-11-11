// The jobs this worker knows. Part A: the eight scheduled crons, each the SAME
// lib/cron/jobs.ts definition the Vercel route runs, with worker-side
// dependencies (service client, cache purge through the Next app, a direct
// read of the contact number). Part B appends its jobs to `buildJobs`.

import { loadContactPhoneFrom } from "@/lib/contact-phone-load";
import { CRON_JOB_NAMES, CRON_JOBS, type CronJobName } from "@/lib/cron/jobs";
import { createServiceClient } from "@/lib/supabase/service";

import type { JobDefinition } from "./registry";

const HOUR = 3600_000;

/**
 * How long after a successful run a Vercel-forwarded trigger of the same job
 * is answered from that run. Vercel Hobby fires a daily cron anywhere inside
 * its hour, the worker fires on the minute, so a few hours covers the overlap
 * without swallowing the next day's run.
 */
const DEDUPE: Record<CronJobName, number> = {
  "supplier-refresh": 6 * HOUR,
  "voltaat-sync": 6 * HOUR,
  "delivery-promises": 6 * HOUR,
  notifications: 6 * HOUR,
  "anonymous-cleanup": 6 * HOUR,
  "youtube-retire": 6 * HOUR,
  "cc-payments-expire": HOUR / 2,
  "cc-weekly-progress": 6 * HOUR,
};

export const refreshContactPhone = () => loadContactPhoneFrom(createServiceClient());

export function cronJobDefinitions(): JobDefinition[] {
  return CRON_JOB_NAMES.map((name) => {
    const job = CRON_JOBS[name];
    return {
      name,
      description: `cron ${name} (Vercel: ${job.utc} UTC${job.inVercelJson ? "" : ", not in vercel.json"})`,
      schedule: { cron: job.qatar, timezone: "Asia/Qatar", vercelUtc: job.utc },
      dedupeWindowMs: DEDUPE[name],
      run: (ctx) =>
        job.run({
          db: createServiceClient,
          siteUrl: ctx.siteUrl,
          purge: ctx.purge,
          refreshContactPhone,
        }),
    };
  });
}

export function buildJobs(): JobDefinition[] {
  return [...cronJobDefinitions()];
}
