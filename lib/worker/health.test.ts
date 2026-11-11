import { describe, expect, it, vi } from "vitest";

import { workerEnv } from "./config";
import { forwardCronJob } from "./forward";
import { createHealthMonitor } from "./health";

const healthy = () => Response.json({ ok: true });

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("worker health", () => {
  it("probes /healthz with a 3 s timeout and trusts an OK for 30 s", async () => {
    const c = clock();
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => healthy());
    const h = createHealthMonitor({ url: "https://worker.example.com/", fetchImpl: fetchImpl as typeof fetch, now: c.now });
    expect(await h.check()).toBe("up");
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://worker.example.com/healthz");
    expect(fetchImpl.mock.calls[0]![1]!.signal).toBeInstanceOf(AbortSignal);
    c.advance(10_000);
    expect(await h.check()).toBe("up");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    c.advance(25_000);
    await h.check();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("one failed probe is retried; two failures within 60 s = down for 60 s without probing", async () => {
    const c = clock();
    const fetchImpl = vi.fn<() => Promise<Response>>(async () => {
      throw new TypeError("fetch failed");
    });
    const h = createHealthMonitor({ url: "https://w.test", fetchImpl: fetchImpl as unknown as typeof fetch, now: c.now });
    expect(await h.check()).toBe("down");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    c.advance(30_000);
    expect(await h.check()).toBe("down");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    c.advance(31_000);
    fetchImpl.mockImplementation(async () => healthy());
    expect(await h.check()).toBe("up");
  });

  it("a blip followed by success stays up", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("bad gateway", { status: 502 })).mockResolvedValueOnce(healthy());
    const h = createHealthMonitor({ url: "https://w.test", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await h.check()).toBe("up");
  });

  it("a non-JSON or ok:false answer is a failure (tunnel error pages answer 200 too)", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));
    expect(await createHealthMonitor({ url: "https://w.test", fetchImpl: fetchImpl as unknown as typeof fetch }).check()).toBe("down");
  });

  it("recordFailure (a failed forward) counts toward down, failures older than 60 s do not", async () => {
    const c = clock();
    const fetchImpl = vi.fn(async () => healthy());
    const h = createHealthMonitor({ url: "https://w.test", fetchImpl: fetchImpl as unknown as typeof fetch, now: c.now });
    h.recordFailure();
    c.advance(61_000);
    h.recordFailure();
    expect(h.state()).toEqual({ failures: 1, down: false });
    c.advance(5_000);
    h.recordFailure();
    expect(h.state().down).toBe(true);
    expect(await h.check()).toBe("down");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("forwardCronJob", () => {
  const opts = (fetchImpl: unknown) => ({ url: "https://w.test/", secret: "s".repeat(32), timeoutMs: 5_000, fetchImpl: fetchImpl as typeof fetch });

  it("posts with the secret and unwraps the envelope", async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      Response.json({ job: "voltaat-sync", run_id: "r", status: 500, body: { error: "x" }, ms: 3 }),
    );
    expect(await forwardCronJob("voltaat-sync", opts(fetchImpl))).toEqual({ kind: "ok", status: 500, body: { error: "x" }, deduped: false });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://w.test/jobs/voltaat-sync");
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${"s".repeat(32)}`);
    expect(JSON.parse(String(init!.body))).toEqual({ source: "vercel-cron" });
  });

  it("maps busy, timeout and every kind of failure", async () => {
    expect(await forwardCronJob("x", opts(async () => new Response(null, { status: 409 })))).toEqual({ kind: "busy" });
    const timeout = async () => {
      throw new DOMException("t", "TimeoutError");
    };
    expect(await forwardCronJob("x", opts(timeout))).toEqual({ kind: "timeout" });
    const refused = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await forwardCronJob("x", opts(refused))).toEqual({ kind: "failed", reason: "network" });
    for (const s of [401, 404, 500, 502, 530]) {
      expect(await forwardCronJob("x", opts(async () => new Response("err", { status: s })))).toEqual({ kind: "failed", reason: `http_${s}` });
    }
    expect(await forwardCronJob("x", opts(async () => new Response("<html>", { status: 200 })))).toEqual({ kind: "failed", reason: "bad_json" });
    expect(await forwardCronJob("x", opts(async () => Response.json({ ok: true })))).toEqual({ kind: "failed", reason: "bad_envelope" });
  });
});

describe("workerEnv", () => {
  const secret = "x".repeat(32);
  it("needs an https URL and a 32+ character secret", () => {
    expect(workerEnv({})).toBeNull();
    expect(workerEnv({ WORKER_URL: "https://worker.gestaltung360.com/" })).toBeNull();
    expect(workerEnv({ WORKER_URL: "https://worker.gestaltung360.com", WORKER_SECRET: "short" })).toBeNull();
    expect(workerEnv({ WORKER_URL: "https://worker.gestaltung360.com/", WORKER_SECRET: secret })).toEqual({ url: "https://worker.gestaltung360.com", secret });
    expect(workerEnv({ WORKER_URL: "http://worker.gestaltung360.com", WORKER_SECRET: secret })).toBeNull();
    expect(workerEnv({ WORKER_URL: "not a url", WORKER_SECRET: secret })).toBeNull();
  });
  it("allows http://localhost only outside production", () => {
    expect(workerEnv({ WORKER_URL: "http://localhost:8787", WORKER_SECRET: secret, NODE_ENV: "development" })).not.toBeNull();
    expect(workerEnv({ WORKER_URL: "http://localhost:8787", WORKER_SECRET: secret, NODE_ENV: "production" })).toBeNull();
  });
});
