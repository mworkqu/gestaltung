// Worker entry point (bundled to dist/worker.mjs by build.mjs).

import { createLogger } from "./log";
import { JOBS } from "./jobs";
import { defineRegistry } from "./registry";
import { createJobRunner } from "./runner";
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

const registry = defineRegistry(JOBS);
const runner = createJobRunner({
  registry,
  log,
  siteUrl,
  purge: async () => {
    throw new Error("purge_not_configured");
  },
});

const server = createWorkerServer({ secret, runner, log, version, startedAt: Date.now() });
server.listen(port, host, () => log("info", "worker listening", { port, host, version, jobs: [...registry.keys()] }));

function shutdown(signal: string) {
  log("info", "shutting down", { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
