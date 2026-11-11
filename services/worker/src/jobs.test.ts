// The worker's job list: the same eight crons as the Vercel routes, scheduled
// at the same moments in Asia/Qatar; the scheduler honours the switch and the
// overlap guard; cache purges go to the Next route.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { CRON_JOB_NAMES, CRON_JOBS } from "@/lib/cron/jobs";

import { cronJobDefinitions } from "./jobs";
import { defineRegistry } from "./registry";
import { createRevalidateClient } from "./revalidate";
import { createJobRunner } from "./runner";
import { scheduledTask, startSchedules } from "./scheduler";

const quiet = () => undefined;
const root = path.resolve(__dirname, "../../..");

/** "m h * * d" in UTC -> the same moment at UTC+3 (only hour fields move; none of ours crosses midnight). */
function utcToQatar(expr: string): string {
  const [min, hour, dom, mon, dow] = expr.split(" ");
  if (hour === "*") return expr;
  const h = Number(hour) + 3;
  if (h >= 24) throw new Error("crosses midnight: shift the day field too");
  return [min, String(h), dom, mon, dow].join(" ");
}

describe("cron job list", () => {
  it("covers every vercel.json cron with the same UTC schedule", () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    expect(vercel.crons).toHaveLength(6);
    for (const c of vercel.crons) {
      const name = c.path.replace("/api/cron/", "") as (typeof CRON_JOB_NAMES)[number];
      expect(CRON_JOBS[name]?.utc).toBe(c.schedule);
      expect(CRON_JOBS[name]?.inVercelJson).toBe(true);
    }
    expect(CRON_JOB_NAMES.filter((n) => !CRON_JOBS[n].inVercelJson)).toEqual(["cc-payments-expire", "cc-weekly-progress"]);
  });

  it("has a route for every job", () => {
    for (const name of CRON_JOB_NAMES) expect(fs.existsSync(path.join(root, "app/api/cron", name, "route.ts"))).toBe(true);
  });

  it("schedules each job at the same moment in Asia/Qatar (UTC+3)", () => {
    const defs = cronJobDefinitions();
    expect(defs.map((d) => d.name)).toEqual([...CRON_JOB_NAMES]);
    for (const d of defs) {
      expect(d.schedule?.timezone).toBe("Asia/Qatar");
      expect(d.schedule?.cron).toBe(utcToQatar(CRON_JOBS[d.name as keyof typeof CRON_JOBS].utc));
      expect(d.dedupeWindowMs).toBeGreaterThan(0);
    }
    expect(Object.fromEntries(defs.map((d) => [d.name, d.schedule?.cron]))).toEqual({
      "supplier-refresh": "0 5 * * *",
      "voltaat-sync": "0 6 * * *",
      "delivery-promises": "0 7 * * *",
      notifications: "30 7 * * *",
      "anonymous-cleanup": "0 8 * * 0",
      "youtube-retire": "0 10 * * *",
      "cc-payments-expire": "0 * * * *",
      "cc-weekly-progress": "0 9 * * 0",
    });
    // An hourly job must not swallow the next hour's run.
    expect(defs.find((d) => d.name === "cc-payments-expire")!.dedupeWindowMs).toBeLessThan(3600_000);
  });
});

describe("scheduler", () => {
  const base = { log: quiet, siteUrl: "https://x.test", purge: async (t: readonly string[]) => [...t] };

  it("skips scheduled runs while the switch is off, runs them when on", async () => {
    const run = vi.fn(async () => ({ status: 200, body: {} }));
    const registry = defineRegistry([{ name: "daily", description: "", dedupeWindowMs: 0, schedule: { cron: "0 5 * * *", timezone: "Asia/Qatar" }, run }]);
    const runner = createJobRunner({ ...base, registry });
    let enabled = false;
    const task = scheduledTask("daily", { runner, log: quiet, isEnabled: async () => enabled });
    await task();
    expect(run).not.toHaveBeenCalled();
    enabled = true;
    await task();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("treats a failing switch read as off", async () => {
    const run = vi.fn(async () => ({ status: 200, body: {} }));
    const runner = createJobRunner({ ...base, registry: defineRegistry([{ name: "daily", description: "", dedupeWindowMs: 0, run }]) });
    await scheduledTask("daily", {
      runner,
      log: quiet,
      isEnabled: async () => {
        throw new Error("db down");
      },
    })();
    expect(run).not.toHaveBeenCalled();
  });

  it("registers one schedule per scheduled job and stops them all", () => {
    const stops: string[] = [];
    const calls: [string, string][] = [];
    const registry = defineRegistry([
      ...cronJobDefinitions(),
      { name: "manual-only", description: "", dedupeWindowMs: 0, run: async () => ({ status: 200, body: {} }) },
    ]);
    const stop = startSchedules({
      registry,
      runner: createJobRunner({ ...base, registry }),
      log: quiet,
      isEnabled: async () => false,
      schedule: (cron, _t, o) => {
        calls.push([o.name, `${cron} ${o.timezone}`]);
        return { stop: () => stops.push(o.name) };
      },
    });
    expect(calls).toHaveLength(8);
    expect(calls).toContainEqual(["supplier-refresh", "0 5 * * * Asia/Qatar"]);
    stop();
    expect(stops).toHaveLength(8);
  });
});

describe("revalidate client", () => {
  it("posts the tags with the secret and returns what Next purged", async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => Response.json({ purged: ["parts-listing", "part-A"] }));
    const purge = createRevalidateClient({ baseUrl: "https://gestaltung360.com/", secret: "s".repeat(32), log: quiet, fetchImpl: fetchImpl as typeof fetch });
    expect(await purge(["parts-listing", "part-A"])).toEqual(["parts-listing", "part-A"]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://gestaltung360.com/api/internal/revalidate");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${"s".repeat(32)}`);
    expect(JSON.parse(String(init!.body))).toEqual({ tags: ["parts-listing", "part-A"] });
    expect(await purge([])).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries once on 5xx / network errors, never on 401, and never throws", async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(Response.json({ purged: ["parts"] }));
    expect(await createRevalidateClient({ baseUrl: "https://x.test", secret: "s", log: quiet, fetchImpl: flaky as unknown as typeof fetch })(["parts"])).toEqual(["parts"]);
    const denied = vi.fn(async () => new Response(null, { status: 401 }));
    expect(await createRevalidateClient({ baseUrl: "https://x.test", secret: "s", log: quiet, fetchImpl: denied as unknown as typeof fetch })(["parts"])).toEqual([]);
    expect(denied).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => new Response(null, { status: 503 }));
    expect(await createRevalidateClient({ baseUrl: "https://x.test", secret: "s", log: quiet, fetchImpl: down as unknown as typeof fetch })(["parts"])).toEqual([]);
    expect(down).toHaveBeenCalledTimes(2);
  });
});
