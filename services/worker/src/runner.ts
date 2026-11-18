// Runs registered jobs: one run per job at a time (overlap guard), the last
// run of each job for /healthz, and de-duplication of Vercel-forwarded runs.
//
// The guard is in memory, per process: the worker is one container. A second
// trigger while a job runs is answered "busy" (HTTP 409) and is NOT queued,
// so a slow supplier refresh can never stack up behind itself.

import { randomUUID } from "node:crypto";

import type { Logger } from "./log";
import type { JobContext, JobOutcome, JobRegistry, JobSource } from "./registry";

export type LastRun = {
  run_id: string;
  source: JobSource;
  started_at: string;
  finished_at: string | null;
  ms: number | null;
  status: number | null;
  ok: boolean | null;
};

export type RunResult =
  | { kind: "unknown" }
  | { kind: "busy"; running: LastRun }
  | { kind: "deduped"; last: LastRun; outcome: JobOutcome }
  | { kind: "done"; run: LastRun; outcome: JobOutcome };

export type RunnerDeps = {
  registry: JobRegistry;
  log: Logger;
  siteUrl: string;
  purge: JobContext["purge"];
  /** Called before every run (e.g. refresh the contact number used in email footers). Errors are logged, never fatal. */
  beforeRun?: () => Promise<unknown>;
  now?: () => Date;
};

export type JobRunner = {
  run(name: string, source: JobSource, opts?: { force?: boolean }): Promise<RunResult>;
  isRunning(name: string): boolean;
  lastRuns(): Record<string, LastRun | null>;
};

export function createJobRunner(deps: RunnerDeps): JobRunner {
  const now = deps.now ?? (() => new Date());
  const running = new Map<string, LastRun>();
  const last = new Map<string, { run: LastRun; outcome: JobOutcome }>();

  async function run(name: string, source: JobSource, opts: { force?: boolean } = {}): Promise<RunResult> {
    const job = deps.registry.get(name);
    if (!job) return { kind: "unknown" };
    const busy = running.get(name);
    if (busy) {
      deps.log("warn", "job busy", { job: name, source, running_since: busy.started_at });
      return { kind: "busy", running: busy };
    }

    const startedAt = now();
    const prev = last.get(name);
    if (
      source === "vercel-cron" &&
      !opts.force &&
      job.dedupeWindowMs > 0 &&
      prev?.run.ok &&
      prev.run.finished_at &&
      startedAt.getTime() - Date.parse(prev.run.finished_at) < job.dedupeWindowMs
    ) {
      deps.log("info", "job deduped", { job: name, source, last_run: prev.run.run_id });
      return { kind: "deduped", last: prev.run, outcome: prev.outcome };
    }

    const entry: LastRun = {
      run_id: randomUUID(),
      source,
      started_at: startedAt.toISOString(),
      finished_at: null,
      ms: null,
      status: null,
      ok: null,
    };
    running.set(name, entry);
    deps.log("info", "job start", { job: name, source, run_id: entry.run_id });
    let outcome: JobOutcome;
    try {
      if (deps.beforeRun) {
        try {
          await deps.beforeRun();
        } catch (e) {
          deps.log("warn", "beforeRun failed", { job: name, error: e });
        }
      }
      outcome = await job.run({ log: deps.log, source, now: startedAt, siteUrl: deps.siteUrl, purge: deps.purge });
    } catch (e) {
      deps.log("error", "job threw", { job: name, run_id: entry.run_id, error: e });
      outcome = { status: 500, body: { error: "job_failed" } };
    } finally {
      running.delete(name);
    }
    const finished = now();
    const done: LastRun = {
      ...entry,
      finished_at: finished.toISOString(),
      ms: finished.getTime() - startedAt.getTime(),
      status: outcome.status,
      ok: outcome.status < 400,
    };
    last.set(name, { run: done, outcome });
    deps.log(done.ok ? "info" : "error", "job done", { job: name, run_id: done.run_id, status: done.status, ms: done.ms });
    return { kind: "done", run: done, outcome };
  }

  return {
    run,
    isRunning: (name) => running.has(name),
    lastRuns() {
      const out: Record<string, LastRun | null> = {};
      for (const name of deps.registry.keys()) out[name] = running.get(name) ?? last.get(name)?.run ?? null;
      return out;
    },
  };
}
