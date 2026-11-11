// The worker's job registry: a typed map from job name to definition. Part A
// registers the scheduled crons (src/jobs.ts); part B adds its jobs to the same
// list, so a job is reachable as POST /jobs/<name> and, with a `schedule`, also
// runs on its own.

import type { Logger } from "./log";

/** What a job returns: the HTTP status and JSON body its Vercel route would answer. */
export type JobOutcome = { status: number; body: unknown };

/** Who started a run. "vercel-cron" = forwarded by a Vercel cron route (may be de-duplicated). */
export type JobSource = "schedule" | "http" | "vercel-cron";

export type JobContext = {
  log: Logger;
  source: JobSource;
  now: Date;
  /** The public site origin used in email links. */
  siteUrl: string;
  /** Purge storefront cache tags through the Next app (POST /api/internal/revalidate). Returns the tags purged. */
  purge: (tags: readonly string[]) => Promise<string[]>;
};

export type JobSchedule = {
  /** node-cron expression in `timezone`. */
  cron: string;
  timezone: "Asia/Qatar";
  /** The schedule the same job has (or would have) on Vercel, UTC, for the docs. */
  vercelUtc?: string;
};

export type JobDefinition = {
  name: string;
  description: string;
  schedule?: JobSchedule;
  /**
   * A run forwarded by Vercel ("vercel-cron") within this many ms after a
   * successful run is answered from that run instead of running again: the
   * worker's own schedule and Vercel's cron both fire for the same slot while
   * vercel.json keeps its crons. 0 = never de-duplicate.
   */
  dedupeWindowMs: number;
  run: (ctx: JobContext) => Promise<JobOutcome>;
};

export type JobRegistry = ReadonlyMap<string, JobDefinition>;

export const JOB_NAME_RE = /^[a-z][a-z0-9-]{1,47}$/;

export function defineRegistry(defs: readonly JobDefinition[]): JobRegistry {
  const map = new Map<string, JobDefinition>();
  for (const d of defs) {
    if (!JOB_NAME_RE.test(d.name)) throw new Error(`invalid job name: ${d.name}`);
    if (map.has(d.name)) throw new Error(`duplicate job: ${d.name}`);
    map.set(d.name, d);
  }
  return map;
}
