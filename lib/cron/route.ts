// The Vercel side of a cron route, after the route checked CRON_SECRET: run
// the shared job (lib/cron/jobs.ts) here, with the in-Vercel dependencies, and
// answer exactly what the route answered before the refactor. SERVER ONLY.

import { revalidateTags } from "@/lib/cache/storefront";
import { getContactPhone } from "@/lib/contact-phone-server";
import { siteUrlFor } from "@/lib/projects/recovery";
import { createServiceClient } from "@/lib/supabase/service";

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

/** What every cron route calls after its auth check. */
export function runCronRoute(name: CronJobName, request: Request): Promise<Response> {
  return runCronLocally(name, request);
}
