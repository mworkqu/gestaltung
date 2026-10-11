// Small fixed-window rate limiter for cheap public endpoints (W7: store
// search suggestions). In memory, per server instance: on Vercel each warm
// function instance keeps its own window, so this is a brake on one client
// hammering an endpoint, not an exact global quota. No storage, no paid
// service. Keys are evicted when their window has passed.

export type RateLimiter = {
  /** Counts one hit for `key`; `allowed` is false once the window's limit is reached. */
  hit(key: string, now?: number): { allowed: boolean; retryAfterSec: number };
};

export function createRateLimiter({ limit, windowMs, maxKeys = 5000 }: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, now = Date.now()) {
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (!w && windows.size >= maxKeys) {
          // Drop expired windows; if still full, drop the oldest entry.
          for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
          if (windows.size >= maxKeys) {
            const oldest = windows.keys().next().value;
            if (oldest !== undefined) windows.delete(oldest);
          }
        }
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      const allowed = w.count <= limit;
      return { allowed, retryAfterSec: allowed ? 0 : Math.max(1, Math.ceil((w.start + windowMs - now) / 1000)) };
    },
  };
}

/** The caller's IP from the proxy headers (Vercel sets x-forwarded-for), or "unknown". */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}
