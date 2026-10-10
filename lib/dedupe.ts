// Request de-duplication for the browser. Pure (no React, no Supabase), so the
// rules are unit-tested.
//
// Why: the header, the cart and the credit badge all mount on every page and
// each used to ask Supabase the same question on its own (auth/v1/user twice,
// rpc/credit_summary three times on one page load). These helpers make
// concurrent askers share one request.

/**
 * Wrap an async function so callers that arrive while it is still running get
 * the SAME promise instead of starting another run. Once it settles (success or
 * failure) the next call starts a fresh run, so nothing is cached for later.
 */
export function shareInflight<T>(fn: () => Promise<T>): () => Promise<T> {
  let inflight: Promise<T> | null = null;
  return () => {
    if (!inflight) {
      inflight = fn().finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}

type Entry<V> = { value: V; at: number };

export type SharedLoader<K extends string, V> = {
  /**
   * The value for `key`: cached if younger than the TTL, else one shared fetch.
   * `force` skips the cache but still joins a fetch that is already running
   * (callers reacting to the same event all land on one request).
   */
  get(key: K, opts?: { force?: boolean }): Promise<V>;
  /** The cached value for `key` if it is still fresh, else undefined. */
  peek(key: K): V | undefined;
  /** Forget `key` (or everything). A fetch already running is not cancelled. */
  invalidate(key?: K): void;
};

/**
 * A small keyed cache with in-flight sharing. Failures are never cached: the
 * rejected promise is dropped, so the next `get` retries.
 */
export function createSharedLoader<K extends string, V>(
  fetcher: (key: K) => Promise<V>,
  opts: { ttlMs?: number; now?: () => number } = {}
): SharedLoader<K, V> {
  const ttl = opts.ttlMs ?? 0;
  const now = opts.now ?? Date.now;
  const cache = new Map<K, Entry<V>>();
  const inflight = new Map<K, Promise<V>>();

  const fresh = (key: K): Entry<V> | undefined => {
    const hit = cache.get(key);
    return hit && now() - hit.at < ttl ? hit : undefined;
  };

  return {
    get(key, o) {
      if (!o?.force) {
        const hit = fresh(key);
        if (hit) return Promise.resolve(hit.value);
      }
      const running = inflight.get(key);
      if (running) return running;
      const p = fetcher(key).then((value) => {
        cache.set(key, { value, at: now() });
        return value;
      });
      const tracked = p.finally(() => {
        if (inflight.get(key) === tracked) inflight.delete(key);
      });
      inflight.set(key, tracked);
      return tracked;
    },
    peek(key) {
      return fresh(key)?.value;
    },
    invalidate(key) {
      if (key === undefined) cache.clear();
      else cache.delete(key);
    },
  };
}

/**
 * Wrap an async function so it runs at most once: every call gets the first
 * run's promise. A failure is not kept (a chunk that failed to download should
 * be fetched again on the next call), so after a rejection the next call
 * starts a fresh run.
 */
export function onceUntilFailure<T>(fn: () => Promise<T>): () => Promise<T> {
  let result: Promise<T> | null = null;
  return () => {
    if (!result) {
      const run = fn();
      result = run;
      run.catch(() => {
        if (result === run) result = null;
      });
    }
    return result;
  };
}
