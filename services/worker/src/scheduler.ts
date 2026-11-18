// Starts each job's own schedule (node-cron in main.ts, injected here so the
// tests need no timer library). A scheduled run first asks `isEnabled()` —
// store_settings.worker — and skips while the switch is off, so a job never
// runs both in Vercel and here. Overlap: the runner refuses a second run of a
// job that is still running (node-cron's noOverlap is set as well).

import type { Logger } from "./log";
import type { JobRegistry } from "./registry";
import type { JobRunner } from "./runner";

export type ScheduleFn = (cron: string, task: () => Promise<void>, opts: { timezone: string; name: string }) => { stop(): unknown };

export type SchedulerDeps = {
  registry: JobRegistry;
  runner: JobRunner;
  schedule: ScheduleFn;
  isEnabled: () => Promise<boolean>;
  log: Logger;
};

/** The task a schedule fires: switch check, then the guarded run. Exported for tests. */
export function scheduledTask(name: string, deps: Omit<SchedulerDeps, "schedule" | "registry">): () => Promise<void> {
  return async () => {
    let enabled = false;
    try {
      enabled = await deps.isEnabled();
    } catch (e) {
      deps.log("warn", "switch read failed", { job: name, error: e });
    }
    if (!enabled) {
      deps.log("info", "scheduled run skipped: worker switched off", { job: name });
      return;
    }
    await deps.runner.run(name, "schedule");
  };
}

export function startSchedules(deps: SchedulerDeps): () => void {
  const tasks: { stop(): unknown }[] = [];
  for (const job of deps.registry.values()) {
    if (!job.schedule) continue;
    tasks.push(deps.schedule(job.schedule.cron, scheduledTask(job.name, deps), { timezone: job.schedule.timezone, name: job.name }));
    deps.log("info", "scheduled", { job: job.name, cron: job.schedule.cron, timezone: job.schedule.timezone });
  }
  return () => {
    for (const t of tasks) t.stop();
  };
}
