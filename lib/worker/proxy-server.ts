// The Next wiring of the part B router (lib/worker/proxy.ts): the worker
// switch from store_settings.worker + WORKER_URL / WORKER_SECRET, and the
// same per-instance health monitor the cron routes use. SERVER ONLY.

import { getWorkerConfig } from "./config";
import { workerHealth } from "./health";
import { createWorkerRouter, type WorkerRouter } from "./proxy";

export const routeViaWorker: WorkerRouter = createWorkerRouter({ getConfig: getWorkerConfig, health: workerHealth });
