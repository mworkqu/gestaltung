// Worker entry point (bundled to dist/worker.mjs by build.mjs).
//
// Environment (names only; docs/WORKER.md says where each value comes from):
//   WORKER_SECRET                 required, 32+ characters, same value as on Vercel
//   NEXT_PUBLIC_SUPABASE_URL      Supabase project URL
//   SUPABASE_SERVICE_ROLE_KEY     service-role key (jobs write with it)
//   NEXT_PUBLIC_SITE_URL          https://gestaltung360.com (email links)
//   REVALIDATE_URL                optional, where to send cache purges (default NEXT_PUBLIC_SITE_URL)
//   WORKER_SCHEDULES              "off" disables the built-in schedules
//   PORT / HOST                   default 8787 / 0.0.0.0
//   + what the jobs themselves read (RESEND_*, MOUSER_API_KEY, DIGIKEY_*, YOUTUBE / Google, CC_*)

import cron from "node-cron";

import { createServiceClient } from "@/lib/supabase/service";
import { readWorkerSettings } from "@/lib/worker/settings";

import { buildJobs, refreshContactPhone } from "./jobs";
import { createLogger } from "./log";
import { defineRegistry } from "./registry";
import { createRevalidateClient } from "./revalidate";
import { createJobRunner } from "./runner";
import { startSchedules } from "./scheduler";
import { createWorkerServer } from "./server";

declare const __WORKER_BUILD_SHA__: string;

const log = createLogger();

function fail(msg: string): never {
  log("error", msg);
  process.exit(1);
}

const secret = process.env.WORKER_SECRET ?? "";
if (secret.length < 32) fail("WORKER_SECRET must be set (at least 32 characters)");

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://gestaltung360.com").replace(/\/+$/, "");
const buildSha = typeof __WORKER_BUILD_SHA__ === "string" ? __WORKER_BUILD_SHA__ : "";
const version = (process.env.GIT_SHA || buildSha || "dev").slice(0, 12);

if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
  log("warn", "Supabase service env missing: jobs will answer no_service_key");
}

const registry = defineRegistry(buildJobs());
const purge = createRevalidateClient({ baseUrl: process.env.REVALIDATE_URL || siteUrl, secret, log });
const runner = createJobRunner({ registry, log, siteUrl, purge, beforeRun: refreshContactPhone });

const server = createWorkerServer({ secret, runner, log, version, startedAt: Date.now() });
server.listen(port, host, () => log("info", "worker listening", { port, host, version, jobs: [...registry.keys()] }));

const stopSchedules =
  process.env.WORKER_SCHEDULES === "off"
    ? () => undefined
    : startSchedules({
        registry,
        runner,
        log,
        isEnabled: async () => (await readWorkerSettings(createServiceClient())).enabled,
        schedule: (expr, task, o) => cron.schedule(expr, task, { timezone: o.timezone, name: o.name, noOverlap: true }),
      });

function shutdown(signal: string) {
  log("info", "shutting down", { signal });
  stopSchedules();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
