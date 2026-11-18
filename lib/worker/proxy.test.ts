import { describe, expect, it, vi } from "vitest";

import type { WorkerConfig } from "./config";
import type { HealthMonitor, WorkerHealth } from "./health";
import { callWorkerProxy, createWorkerRouter } from "./proxy";

const URL_ = "https://mac.example.ts.net";
const SECRET = "w".repeat(40);
const ON: WorkerConfig = { enabled: true, url: URL_, secret: SECRET };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const upstream = (status: number, body: unknown) => json(status, body, { "x-worker-upstream": "cad-worker" });
const proxyError = (status: number, code: string) => json(status, { error: code }, { "x-worker-proxy-error": code });

function monitor(state: WorkerHealth = "up") {
  const recordFailure = vi.fn();
  const m: HealthMonitor = { check: async () => state, recordFailure, state: () => ({ failures: 0, down: state === "down" }) };
  return { m, recordFailure };
}

function router(fetchImpl: typeof fetch, opts: { config?: WorkerConfig; health?: WorkerHealth } = {}) {
  const { m, recordFailure } = monitor(opts.health);
  const route = createWorkerRouter({
    getConfig: async () => opts.config ?? ON,
    health: () => m,
    fetchImpl,
    warn: () => undefined,
  });
  return { route, recordFailure };
}

describe("callWorkerProxy", () => {
  it("posts the body to the proxy path with Bearer WORKER_SECRET only", async () => {
    const fetchMock = vi.fn(async () => upstream(200, { ok: true }));
    const out = await callWorkerProxy("grader-grade-package", { a: 1 }, { url: `${URL_}/`, secret: SECRET, timeoutMs: 1000, fetchImpl: fetchMock as unknown as typeof fetch });
    expect(out).toEqual({ kind: "answered", status: 200, raw: { ok: true } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_}/grader/grade-package`);
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${SECRET}`);
    expect(Object.keys(headers).some((h) => /grader-secret|cad-worker-token/i.test(h))).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 });
  });

  it.each([
    ["a refused connection", () => Promise.reject(new TypeError("fetch failed")), "network"],
    ["404 from an old worker without the proxy", () => Promise.resolve(json(404, { error: "not_found" })), "http_404"],
    ["401 bad WORKER_SECRET", () => Promise.resolve(json(401, { error: "unauthorized" })), "http_401"],
    ["a tunnel error page", () => Promise.resolve(new Response("<html>502</html>", { status: 502 })), "http_502"],
  ])("%s = not accepted by the worker", async (_l, impl, reason) => {
    const out = await callWorkerProxy("cad-build", {}, { url: URL_, secret: SECRET, timeoutMs: 1000, fetchImpl: vi.fn(impl) as unknown as typeof fetch });
    expect(out).toEqual({ kind: "not_accepted", reason, workerFault: true });
  });

  it("container not configured / unreachable / refusing = not accepted, not the worker's fault", async () => {
    for (const r of [proxyError(503, "upstream_not_configured"), proxyError(502, "upstream_unreachable"), upstream(401, { error: "unauthorised" }), upstream(503, { error: "grader_not_configured" })]) {
      const out = await callWorkerProxy("grader-grade", {}, { url: URL_, secret: SECRET, timeoutMs: 1000, fetchImpl: (async () => r) as unknown as typeof fetch });
      expect(out).toMatchObject({ kind: "not_accepted", workerFault: false });
    }
  });

  it("timeouts and lost answers after the worker took the call are NOT 'not accepted'", async () => {
    const timeoutErr = Object.assign(new Error("t"), { name: "TimeoutError" });
    const call = (impl: () => Promise<Response>) =>
      callWorkerProxy("cad-build", {}, { url: URL_, secret: SECRET, timeoutMs: 1000, fetchImpl: vi.fn(impl) as unknown as typeof fetch });
    expect(await call(() => Promise.reject(timeoutErr))).toEqual({ kind: "timeout" });
    expect(await call(() => Promise.resolve(proxyError(504, "upstream_timeout")))).toEqual({ kind: "timeout" });
    expect(await call(() => Promise.resolve(proxyError(502, "upstream_error")))).toEqual({ kind: "lost", reason: "upstream_error" });
  });

  it("passes the container's own status through (a 500 with the build contract is still an answer)", async () => {
    const out = await callWorkerProxy("cad-build", {}, { url: URL_, secret: SECRET, timeoutMs: 1000, fetchImpl: (async () => upstream(500, { ok: false })) as unknown as typeof fetch });
    expect(out).toEqual({ kind: "answered", status: 500, raw: { ok: false } });
  });
});

describe("createWorkerRouter (routing decision)", () => {
  it("switch off → Cloud Run, nothing sent to the Mac", async () => {
    const fetchMock = vi.fn();
    const { route } = router(fetchMock as unknown as typeof fetch, { config: { enabled: false } });
    expect(await route("cad-build", {}, 1000)).toEqual({ engine: "cloud-run", why: "off" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("worker down → Cloud Run, nothing sent to the Mac", async () => {
    const fetchMock = vi.fn();
    const { route } = router(fetchMock as unknown as typeof fetch, { health: "down" });
    expect(await route("grader-grade", {}, 1000)).toEqual({ engine: "cloud-run", why: "down" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("worker on and healthy → the Mac serves it", async () => {
    const { route, recordFailure } = router((async () => upstream(200, { ok: true })) as unknown as typeof fetch);
    expect(await route("cad-build", {}, 1000)).toEqual({ engine: "mac", outcome: { kind: "answered", status: 200, raw: { ok: true } } });
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("worker refuses → Cloud Run, and it counts against the worker's health", async () => {
    const { route, recordFailure } = router((async () => json(404, { error: "not_found" })) as unknown as typeof fetch);
    expect(await route("cad-build", {}, 1000)).toEqual({ engine: "cloud-run", why: "not_accepted", detail: "http_404" });
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("container down on a healthy Mac → Cloud Run, the worker's health is untouched (crons stay on the Mac)", async () => {
    const { route, recordFailure } = router((async () => proxyError(502, "upstream_unreachable")) as unknown as typeof fetch);
    expect(await route("grader-grade", {}, 1000)).toMatchObject({ engine: "cloud-run", why: "not_accepted" });
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("accepted + timeout → stays on the Mac (no Cloud Run fallback), health failure recorded", async () => {
    const timeoutErr = Object.assign(new Error("t"), { name: "TimeoutError" });
    const { route, recordFailure } = router((() => Promise.reject(timeoutErr)) as unknown as typeof fetch);
    expect(await route("cad-build", {}, 1000)).toEqual({ engine: "mac", outcome: { kind: "timeout" } });
    expect(recordFailure).toHaveBeenCalledTimes(1);
  });

  it("a config read that throws = off", async () => {
    const route = createWorkerRouter({
      getConfig: async () => {
        throw new Error("db");
      },
      health: () => monitor().m,
      warn: () => undefined,
    });
    expect(await route("cad-build", {}, 1000)).toEqual({ engine: "cloud-run", why: "off" });
  });
});
