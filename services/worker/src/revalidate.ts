// Cache purges from the worker: Next's revalidateTag only works inside the
// Next app, so the worker asks it through POST /api/internal/revalidate
// (Bearer WORKER_SECRET). One retry on a network error / 5xx / 429. Never
// throws: a failed purge is logged and answered with [] (nothing purged), and
// the pages then refresh on their own 24 h expiry.

import type { Logger } from "./log";

export type RevalidateOptions = {
  baseUrl: string;
  secret: string;
  log: Logger;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export function createRevalidateClient(opts: RevalidateOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/internal/revalidate`;
  return async function purge(tags: readonly string[]): Promise<string[]> {
    if (!tags.length) return [];
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.secret}`, "content-type": "application/json" },
          body: JSON.stringify({ tags }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
        lastStatus = res.status;
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as { purged?: unknown } | null;
          const purged = Array.isArray(body?.purged) ? body.purged.filter((t): t is string => typeof t === "string") : [];
          opts.log("info", "cache purged", { tags: purged.length });
          return purged;
        }
        if (res.status < 500 && res.status !== 429) break; // 400 / 401: retrying will not help
      } catch (e) {
        opts.log("warn", "cache purge attempt failed", { attempt, error: e });
      }
    }
    opts.log("error", "cache purge failed", { status: lastStatus, tags: tags.length });
    return [];
  };
}
