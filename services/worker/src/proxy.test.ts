// Part B proxy: auth, body cap, forwarding (path, body, the containers' own
// secrets added by the worker), pass-through of the answer and the proxy's
// own error codes. Real HTTP on 127.0.0.1 only: a fake "container" stands in
// for cad-worker / grader.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createProxy, proxyConfigFromEnv, PROXY_MAX_BODY_BYTES, type ProxyConfig } from "./proxy";
import { defineRegistry } from "./registry";
import { createJobRunner } from "./runner";
import { createWorkerServer } from "./server";

const SECRET = "s".repeat(40);
const quiet = () => undefined;

type Seen = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };
let seen: Seen[] = [];
let reply: { status: number; body: string; delayMs?: number } = { status: 200, body: "{}" };

let upstream: Server;
let upstreamUrl = "";
let worker: Server;
let base = "";
let lines: string[] = [];

function listen(s: Server): Promise<string> {
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
}

function startWorker(config: ProxyConfig, opts: { timeoutMs?: number } = {}) {
  const proxy = createProxy({ config });
  const runner = createJobRunner({ registry: defineRegistry([]), log: quiet, siteUrl: "https://x", purge: async () => [] });
  return createWorkerServer({
    secret: SECRET,
    runner,
    log: (level, msg, fields) => lines.push(JSON.stringify({ level, msg, ...fields })),
    version: "test",
    startedAt: Date.now(),
    proxy: opts.timeoutMs
      ? { ...proxy, forward: (route, body) => proxy.forward({ ...route, timeoutMs: opts.timeoutMs! }, body) }
      : proxy,
  });
}

beforeAll(async () => {
  upstream = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      const send = () => {
        if (res.destroyed) return;
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(reply.body);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs);
      else send();
    });
  });
  upstreamUrl = await listen(upstream);
  worker = startWorker({ cadUrl: upstreamUrl, graderUrl: upstreamUrl, cadToken: "cad-tok", graderSecret: "grader-sec" });
  base = await listen(worker);
});

afterAll(async () => {
  await new Promise((r) => worker.close(r));
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
});

beforeEach(() => {
  seen = [];
  lines = [];
  reply = { status: 200, body: "{}" };
});

const post = (path: string, body: string, auth = `Bearer ${SECRET}`, at = base) =>
  fetch(`${at}${path}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body });

describe("proxy config", () => {
  it("defaults to the compose service names; secrets only from the env", () => {
    expect(proxyConfigFromEnv({})).toEqual({ cadUrl: "http://cad-worker:8080", graderUrl: "http://grader:8080", cadToken: null, graderSecret: null });
    expect(proxyConfigFromEnv({ CAD_WORKER_URL: "http://x:1/", GRADER_URL: " http://y:2 ", CAD_WORKER_TOKEN: "a", GRADER_SECRET: "b" })).toEqual({
      cadUrl: "http://x:1",
      graderUrl: "http://y:2",
      cadToken: "a",
      graderSecret: "b",
    });
  });
});

describe("auth", () => {
  it("401 without / with a wrong secret, and nothing is forwarded", async () => {
    for (const auth of ["", "Bearer nope", `Bearer ${SECRET}x`, SECRET]) {
      const r = await post("/cad/build", "{}", auth);
      expect(r.status).toBe(401);
    }
    expect(seen).toHaveLength(0);
  });
  it("405 for GET", async () => {
    const r = await fetch(`${base}/grader/grade`);
    expect(r.status).toBe(405);
  });
});

describe("body", () => {
  it("413 over 1 MiB, nothing forwarded", async () => {
    const big = JSON.stringify({ code: "x".repeat(PROXY_MAX_BODY_BYTES) });
    const r = await post("/cad/build", big);
    expect(r.status).toBe(413);
    expect(seen).toHaveLength(0);
  });
  it("accepts far more than the 16 KiB /jobs cap (a 200 KB grading package)", async () => {
    const files = Array.from({ length: 400 }, (_, i) => ({ name: `p${i}.step`, file_url: `https://x.supabase.co/storage/v1/object/sign/${"a".repeat(400)}` }));
    const r = await post("/grader/grade-package", JSON.stringify({ files }));
    expect(r.status).toBe(200);
    expect(seen).toHaveLength(1);
  });
  it("400 for bad JSON", async () => {
    const r = await post("/grader/grade", "{nope");
    expect(r.status).toBe(400);
    expect(seen).toHaveLength(0);
  });
});

describe("forwarding", () => {
  it("POST /cad/build → /build with X-Cad-Worker-Token from the Mac's env, never the WORKER_SECRET", async () => {
    reply = { status: 200, body: JSON.stringify({ ok: true, step_b64: "U1RFUA==" }) };
    const body = JSON.stringify({ code: "result = 1", units: "mm", checks: { min_wall_mm: 1.2, must_contain_box: null } });
    const r = await post("/cad/build", body);
    expect(r.status).toBe(200);
    expect(r.headers.get("x-worker-upstream")).toBe("cad-worker");
    expect(await r.json()).toEqual({ ok: true, step_b64: "U1RFUA==" });
    expect(seen[0]).toMatchObject({ method: "POST", url: "/build", body });
    expect(seen[0]!.headers["x-cad-worker-token"]).toBe("cad-tok");
    expect(seen[0]!.headers["x-grader-secret"]).toBeUndefined();
    expect(seen[0]!.headers.authorization).toBeUndefined();
  });

  it.each([
    ["/grader/grade", "/grade"],
    ["/grader/grade-package", "/grade-package"],
    ["/grader/reference", "/reference"],
  ])("%s → %s with X-Grader-Secret", async (path, upstreamPath) => {
    const r = await post(path, JSON.stringify({ file_url: "https://x" }));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-worker-upstream")).toBe("grader");
    expect(seen[0]!.url).toBe(upstreamPath);
    expect(seen[0]!.headers["x-grader-secret"]).toBe("grader-sec");
    expect(seen[0]!.headers["x-cad-worker-token"]).toBeUndefined();
  });

  it("passes the container's status and body through unchanged (422, 500)", async () => {
    for (const status of [422, 500]) {
      reply = { status, body: JSON.stringify({ ok: false, error: "bad" }) };
      const r = await post("/cad/build", "{}");
      expect(r.status).toBe(status);
      expect(r.headers.get("x-worker-upstream")).toBe("cad-worker");
      expect(r.headers.get("x-worker-proxy-error")).toBeNull();
      expect(await r.json()).toEqual({ ok: false, error: "bad" });
    }
  });

  it("never logs the body or the secrets", async () => {
    await post("/grader/grade", JSON.stringify({ file_url: "https://signed.example/very-secret-token" }));
    const all = lines.join("\n");
    expect(all).not.toContain("very-secret-token");
    expect(all).not.toContain("grader-sec");
    expect(all).not.toContain(SECRET);
  });
});

describe("the proxy's own errors", () => {
  it("container unreachable → 502 upstream_unreachable (nothing ran)", async () => {
    // A port that was just free: connection refused (fetch blocks port 1 as a "bad port").
    const probe = createServer();
    const freeUrl = await listen(probe);
    await new Promise((res) => probe.close(res));
    const dead = startWorker({ cadUrl: freeUrl, graderUrl: freeUrl, cadToken: null, graderSecret: null });
    const at = await listen(dead);
    try {
      const r = await post("/cad/build", "{}", `Bearer ${SECRET}`, at);
      expect(r.status).toBe(502);
      expect(r.headers.get("x-worker-proxy-error")).toBe("upstream_unreachable");
      expect(r.headers.get("x-worker-upstream")).toBeNull();
    } finally {
      await new Promise((res) => dead.close(res));
    }
  });

  it("container too slow → 504 upstream_timeout (it may have run)", async () => {
    const slow = startWorker({ cadUrl: upstreamUrl, graderUrl: upstreamUrl, cadToken: null, graderSecret: null }, { timeoutMs: 50 });
    const at = await listen(slow);
    reply = { status: 200, body: "{}", delayMs: 400 };
    try {
      const r = await post("/cad/build", "{}", `Bearer ${SECRET}`, at);
      expect(r.status).toBe(504);
      expect(r.headers.get("x-worker-proxy-error")).toBe("upstream_timeout");
    } finally {
      await new Promise((res) => slow.close(res));
    }
  });

  it("healthz reports the upstreams (refreshed in the background)", async () => {
    const r = await fetch(`${base}/healthz`);
    const j = (await r.json()) as { ok: boolean; upstreams: Record<string, string> };
    expect(j.ok).toBe(true);
    expect(Object.keys(j.upstreams).sort()).toEqual(["cad", "grader"]);
  });
});

describe("without a proxy (part A only)", () => {
  it("the proxy paths are 404", async () => {
    const runner = createJobRunner({ registry: defineRegistry([]), log: quiet, siteUrl: "https://x", purge: async () => [] });
    const plain = createWorkerServer({ secret: SECRET, runner, log: quiet, version: "t", startedAt: Date.now() });
    const at = await listen(plain);
    try {
      const r = await post("/cad/build", "{}", `Bearer ${SECRET}`, at);
      expect(r.status).toBe(404);
    } finally {
      await new Promise((res) => plain.close(res));
    }
  });
});
