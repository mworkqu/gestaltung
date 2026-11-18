// Part B, Vercel side: send a CAD build or a grading call to the Mac Mini
// worker first, and tell the caller whether to use Cloud Run instead. Pure
// apart from the injected fetch / config / health; no Next imports (the Next
// wiring is lib/worker/proxy-server.ts).
//
// Decision (createWorkerRouter):
//   switch off, WORKER_URL / WORKER_SECRET missing  -> cloud-run (nothing sent)
//   worker "down" by the shared health monitor      -> cloud-run (nothing sent)
//   worker did not take the call (not_accepted)     -> cloud-run: connection refused /
//       tunnel error page, 401/403/404/413/5xx from the worker itself (an old worker
//       without the proxy answers 404), or the worker says the container is not
//       configured / unreachable / refused it (401, 403 or 503 from the container)
//   worker took it and timed out, or lost the answer -> mac, NO fallback (the build or
//       grade may still be running there); the caller's existing failure path runs
//   worker answered                                  -> mac, the container's status + JSON
//
// So a call never runs on Cloud Run after the Mac may have run it. Neither path
// charges anything by itself: CAD credits are spent by cad_deliver only after a
// delivered result (lib/cad/cloud-flow.ts), and grading has no credit.

import type { WorkerConfig } from "./config";
import type { HealthMonitor } from "./health";

export type ProxyTarget = "cad-build" | "grader-grade" | "grader-grade-package" | "grader-reference";

export const PROXY_PATHS: Readonly<Record<ProxyTarget, string>> = {
  "cad-build": "/cad/build",
  "grader-grade": "/grader/grade",
  "grader-grade-package": "/grader/grade-package",
  "grader-reference": "/grader/reference",
};

/** The two engines a CAD build or grade can run on; recorded in the usage / grading logs. */
export type Engine = "mac" | "cloud-run";

export type ProxyOutcome =
  | { kind: "answered"; status: number; raw: unknown }
  | { kind: "not_accepted"; reason: string; workerFault: boolean }
  | { kind: "timeout" }
  | { kind: "lost"; reason: string };

/** Errors the worker itself reports in x-worker-proxy-error, and what they mean here. */
const NOTHING_RAN = new Set(["upstream_not_configured", "upstream_unreachable"]);

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

export type ProxyCallOptions = { url: string; secret: string; timeoutMs: number; fetchImpl?: typeof fetch };

/** One POST to the worker proxy. Never throws. */
export async function callWorkerProxy(target: ProxyTarget, body: unknown, opts: ProxyCallOptions): Promise<ProxyOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.url.replace(/\/+$/, "")}${PROXY_PATHS[target]}`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    if (isTimeout(e)) return { kind: "timeout" };
    // No answer at all (refused, DNS, tunnel down): the worker never took the call.
    return { kind: "not_accepted", reason: "network", workerFault: true };
  }

  const proxyError = res.headers.get("x-worker-proxy-error");
  if (proxyError) {
    await res.body?.cancel().catch(() => undefined);
    if (NOTHING_RAN.has(proxyError)) return { kind: "not_accepted", reason: proxyError, workerFault: false };
    if (proxyError === "upstream_timeout") return { kind: "timeout" };
    return { kind: "lost", reason: proxyError };
  }

  if (!res.headers.get("x-worker-upstream")) {
    // The worker (or the tunnel in front of it) refused before any container saw the call.
    await res.body?.cancel().catch(() => undefined);
    return { kind: "not_accepted", reason: `http_${res.status}`, workerFault: true };
  }

  // The container's own refusal: wrong / missing secret on the Mac, or not configured there.
  if (res.status === 401 || res.status === 403 || res.status === 503) {
    await res.body?.cancel().catch(() => undefined);
    return { kind: "not_accepted", reason: `upstream_http_${res.status}`, workerFault: false };
  }

  try {
    const raw: unknown = await res.json().catch((e: unknown) => {
      if (isTimeout(e)) throw e;
      return null;
    });
    return { kind: "answered", status: res.status, raw };
  } catch {
    return { kind: "timeout" };
  }
}

export type RouteAttempt =
  | { engine: "mac"; outcome: Exclude<ProxyOutcome, { kind: "not_accepted" }> }
  | { engine: "cloud-run"; why: "off" | "down" | "not_accepted"; detail?: string };

export type WorkerRouter = (target: ProxyTarget, body: unknown, timeoutMs: number) => Promise<RouteAttempt>;

export type RouterDeps = {
  getConfig: () => Promise<WorkerConfig>;
  health: (url: string) => HealthMonitor;
  fetchImpl?: typeof fetch;
  warn?: (msg: string) => void;
};

export function createWorkerRouter(deps: RouterDeps): WorkerRouter {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  return async (target, body, timeoutMs) => {
    let cfg: WorkerConfig;
    try {
      cfg = await deps.getConfig();
    } catch {
      return { engine: "cloud-run", why: "off" };
    }
    if (!cfg.enabled) return { engine: "cloud-run", why: "off" };
    const health = deps.health(cfg.url);
    if ((await health.check()) === "down") {
      warn(`[worker] ${target}: worker down, using Cloud Run`);
      return { engine: "cloud-run", why: "down" };
    }
    const outcome = await callWorkerProxy(target, body, { url: cfg.url, secret: cfg.secret, timeoutMs, fetchImpl: deps.fetchImpl });
    switch (outcome.kind) {
      case "not_accepted":
        // Only a fault of the worker itself counts against its health (a stopped
        // container on a healthy Mac must not send the crons back to Vercel).
        if (outcome.workerFault) health.recordFailure();
        warn(`[worker] ${target}: not accepted (${outcome.reason}), using Cloud Run`);
        return { engine: "cloud-run", why: "not_accepted", detail: outcome.reason };
      case "timeout":
        health.recordFailure();
        warn(`[worker] ${target}: accepted but no answer in time; not sent to Cloud Run`);
        return { engine: "mac", outcome };
      case "lost":
        warn(`[worker] ${target}: answer lost (${outcome.reason}); not sent to Cloud Run`);
        return { engine: "mac", outcome };
      case "answered":
        return { engine: "mac", outcome };
    }
  };
}
