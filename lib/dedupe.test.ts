import { describe, expect, it, vi } from "vitest";

import { createSharedLoader, onceUntilFailure, shareInflight } from "./dedupe";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("shareInflight", () => {
  it("runs once for callers that overlap and gives them the same result", async () => {
    const d = deferred<string>();
    const fn = vi.fn(() => d.promise);
    const shared = shareInflight(fn);
    const a = shared();
    const b = shared();
    const c = shared();
    expect(fn).toHaveBeenCalledTimes(1);
    d.resolve("user");
    expect(await Promise.all([a, b, c])).toEqual(["user", "user", "user"]);
  });

  it("runs again for a call made after the first run settled (nothing is cached)", async () => {
    const fn = vi.fn(async () => "x");
    const shared = shareInflight(fn);
    await shared();
    await shared();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not stay stuck after a failure", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const shared = shareInflight(fn);
    await expect(shared()).rejects.toThrow("boom");
    await expect(shared()).resolves.toBe("ok");
  });
});

describe("createSharedLoader", () => {
  it("shares one fetch between simultaneous callers of the same key", async () => {
    const d = deferred<number>();
    const fetcher = vi.fn(() => d.promise);
    const loader = createSharedLoader<string, number>(fetcher, { ttlMs: 1000 });
    const p = [loader.get("u1"), loader.get("u1"), loader.get("u1")];
    expect(fetcher).toHaveBeenCalledTimes(1);
    d.resolve(7);
    expect(await Promise.all(p)).toEqual([7, 7, 7]);
  });

  it("serves the cached value inside the TTL and refetches after it", async () => {
    let t = 0;
    const fetcher = vi.fn(async () => ++t);
    const clock = { now: 0 };
    const loader = createSharedLoader<string, number>(fetcher, { ttlMs: 1000, now: () => clock.now });
    expect(await loader.get("u1")).toBe(1);
    clock.now = 999;
    expect(await loader.get("u1")).toBe(1);
    expect(loader.peek("u1")).toBe(1);
    clock.now = 1000;
    expect(loader.peek("u1")).toBeUndefined();
    expect(await loader.get("u1")).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps keys apart (a different user never sees the previous user's value)", async () => {
    const fetcher = vi.fn(async (k: string) => `summary:${k}`);
    const loader = createSharedLoader<string, string>(fetcher, { ttlMs: 1000 });
    expect(await loader.get("a")).toBe("summary:a");
    expect(await loader.get("b")).toBe("summary:b");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("force skips the cache but joins a fetch that is already running", async () => {
    const d = deferred<number>();
    const fetcher = vi.fn(() => d.promise);
    const loader = createSharedLoader<string, number>(fetcher, { ttlMs: 1000 });
    const first = loader.get("u1", { force: true });
    const second = loader.get("u1", { force: true });
    expect(fetcher).toHaveBeenCalledTimes(1);
    d.resolve(3);
    expect(await Promise.all([first, second])).toEqual([3, 3]);
    // Cached now, yet force still refetches.
    fetcher.mockImplementation(async () => 4);
    expect(await loader.get("u1", { force: true })).toBe(4);
  });

  it("invalidate drops the cached value", async () => {
    let n = 0;
    const loader = createSharedLoader<string, number>(async () => ++n, { ttlMs: 60_000 });
    expect(await loader.get("u1")).toBe(1);
    loader.invalidate("u1");
    expect(loader.peek("u1")).toBeUndefined();
    expect(await loader.get("u1")).toBe(2);
    loader.invalidate();
    expect(await loader.get("u1")).toBe(3);
  });

  it("never caches a failure", async () => {
    const fetcher = vi
      .fn<(k: string) => Promise<number>>()
      .mockRejectedValueOnce(new Error("rpc down"))
      .mockResolvedValueOnce(5);
    const loader = createSharedLoader<string, number>(fetcher, { ttlMs: 60_000 });
    await expect(loader.get("u1")).rejects.toThrow("rpc down");
    expect(loader.peek("u1")).toBeUndefined();
    await expect(loader.get("u1")).resolves.toBe(5);
  });
});

describe("onceUntilFailure", () => {
  it("runs once and hands every caller, now and later, the same result", async () => {
    const fn = vi.fn(async () => ({ mod: 1 }));
    const once = onceUntilFailure(fn);
    const a = once();
    const b = once();
    expect(a).toBe(b);
    const first = await a;
    expect(await once()).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("forgets a failure so the next call retries", async () => {
    const d = deferred<number>();
    const fn = vi.fn().mockReturnValueOnce(d.promise).mockResolvedValueOnce(7);
    const once = onceUntilFailure(fn as () => Promise<number>);
    const a = once();
    expect(once()).toBe(a);
    d.reject(new Error("chunk load failed"));
    await expect(a).rejects.toThrow("chunk load failed");
    await expect(once()).resolves.toBe(7);
    await expect(once()).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
