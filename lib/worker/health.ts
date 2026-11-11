// Is the Mac Mini worker reachable? GET <WORKER_URL>/healthz with a 3 s
// timeout. Per Vercel instance (module state, no storage):
//   - a healthy answer is trusted for 30 s;
//   - 2 failures within 60 s (a failed probe, or a failed forward reported
//     with recordFailure) mark it "down" for 60 s, and no probe is made
//     meanwhile;
//   - one failed probe is retried at once, so a single blip does not send a
//     cron back to Vercel but a dead tunnel is decided within ~6 s.
// Pure apart from the injected fetch; no Next imports.

export type WorkerHealth = "up" | "down";

export type HealthOptions = {
  url: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  windowMs?: number;
  failuresToDown?: number;
  okCacheMs?: number;
};

export const HEALTH_TIMEOUT_MS = 3_000;
export const HEALTH_WINDOW_MS = 60_000;
export const HEALTH_FAILURES_TO_DOWN = 2;
export const HEALTH_OK_CACHE_MS = 30_000;

export type HealthMonitor = {
  check(): Promise<WorkerHealth>;
  recordFailure(): void;
  state(): { failures: number; down: boolean };
};

export function createHealthMonitor(opts: HealthOptions): HealthMonitor {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? HEALTH_TIMEOUT_MS;
  const windowMs = opts.windowMs ?? HEALTH_WINDOW_MS;
  const toDown = opts.failuresToDown ?? HEALTH_FAILURES_TO_DOWN;
  const okCacheMs = opts.okCacheMs ?? HEALTH_OK_CACHE_MS;
  const healthz = `${opts.url.replace(/\/+$/, "")}/healthz`;

  let failures: number[] = [];
  let downUntil = 0;
  let okUntil = 0;

  function recordFailure(): void {
    const t = now();
    okUntil = 0;
    failures = failures.filter((f) => t - f < windowMs);
    failures.push(t);
    if (failures.length >= toDown) downUntil = t + windowMs;
  }

  async function probe(): Promise<boolean> {
    try {
      const res = await doFetch(healthz, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return false;
      const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
      return body?.ok === true;
    } catch {
      return false;
    }
  }

  async function check(): Promise<WorkerHealth> {
    const t = now();
    if (downUntil > t) return "down";
    if (okUntil > t) return "up";
    for (let attempt = 0; attempt < toDown; attempt++) {
      if (await probe()) {
        failures = [];
        downUntil = 0;
        okUntil = now() + okCacheMs;
        return "up";
      }
      recordFailure();
      if (downUntil > now()) return "down";
    }
    return "down";
  }

  return {
    check,
    recordFailure,
    state: () => ({ failures: failures.length, down: downUntil > now() }),
  };
}

const monitors = new Map<string, HealthMonitor>();

/** One monitor per worker URL per server instance. */
export function workerHealth(url: string): HealthMonitor {
  let m = monitors.get(url);
  if (!m) {
    m = createHealthMonitor({ url });
    monitors.set(url, m);
  }
  return m;
}
