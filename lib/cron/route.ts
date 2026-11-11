// The Vercel side of a cron route, after the route checked CRON_SECRET: run
// the shared job (lib/cron/jobs.ts) here, with the in-Vercel dependencies, and
// answer exactly what the route answered before the refactor — or, with the
// worker switch on, forward it to the Mac Mini worker. SERVER ONLY.

import { revalidateTags } from "@/lib/cache/storefront";
import { getContactPhone } from "@/lib/contact-phone-server";
import { siteUrlFor } from "@/lib/projects/recovery";
import { createServiceClient } from "@/lib/supabase/service";
import { getWorkerConfig } from "@/lib/worker/config";
import { forwardCronJob } from "@/lib/worker/forward";
import { workerHealth } from "@/lib/worker/health";

import { CRON_JOBS, type CronDeps, type CronJobName } from "./jobs";

export function localCronDeps(request: Request): CronDeps {
  return {
    db: createServiceClient,
    siteUrl: siteUrlFor(request.url),
    purge: revalidateTags,
    refreshContactPhone: getContactPhone,
  };
}

/** Runs the job in this Vercel function. */
export async function runCronLocally(name: CronJobName, request: Request): Promise<Response> {
  const outcome = await CRON_JOBS[name].run(localCronDeps(request));
  return Response.json(outcome.body, { status: outcome.status });
}

/**
 * How long a forwarded run may take before the route gives up waiting: under
 * each route's maxDuration (300 s for the two supplier syncs, 60 s for the
 * rest), leaving room for the fallback when the worker refuses quickly.
 */
export const FORWARD_TIMEOUT_MS: Readonly<Record<CronJobName, number>> = {
  "supplier-refresh": 240_000,
  "voltaat-sync": 240_000,
  "delivery-promises": 45_000,
  notifications: 45_000,
  "anonymous-cleanup": 45_000,
  "youtube-retire": 45_000,
  "cc-payments-expire": 45_000,
  "cc-weekly-progress": 45_000,
};

const VIA_WORKER = { "x-cron-runner": "worker" };

/**
 * What every cron route calls after its auth check (docs/WORKER.md step 11).
 * Switch off (the default: no WORKER_URL / WORKER_SECRET, or
 * store_settings.worker not {"enabled": true}) → run here, exactly as before;
 * no request goes anywhere. Switch on → if the worker is healthy, forward and
 * return its answer; if it refuses or is down, run here; if it accepted the run
 * but did not answer in time, do NOT run it a second time here (504).
 */
export async function runCronRoute(name: CronJobName, request: Request): Promise<Response> {
  const cfg = await getWorkerConfig();
  if (!cfg.enabled) return runCronLocally(name, request);

  const health = workerHealth(cfg.url);
  if ((await health.check()) === "down") {
    console.warn(`[cron] ${name}: worker down, running in Vercel`);
    return runCronLocally(name, request);
  }
  const r = await forwardCronJob(name, { url: cfg.url, secret: cfg.secret, timeoutMs: FORWARD_TIMEOUT_MS[name] });
  switch (r.kind) {
    case "ok":
      return Response.json(r.body, { status: r.status, headers: VIA_WORKER });
    case "busy":
      return Response.json({ error: "already_running" }, { status: 409, headers: VIA_WORKER });
    case "timeout":
      health.recordFailure();
      console.error(`[cron] ${name}: worker accepted but did not answer in time; not run again here`);
      return Response.json({ error: "worker_timeout" }, { status: 504, headers: VIA_WORKER });
    case "failed":
      health.recordFailure();
      console.warn(`[cron] ${name}: worker refused (${r.reason}), running in Vercel`);
      return runCronLocally(name, request);
  }
}
