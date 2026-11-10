// Worker core: logging redaction, the job registry, the overlap guard and
// de-duplication, and the HTTP surface (auth, CORS, body cap). No network
// beyond 127.0.0.1, no database, no real job.
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { formatLine, redact } from "./log";
import { defineRegistry, type JobDefinition, type JobOutcome } from "./registry";
import { createJobRunner } from "./runner";
import { createWorkerServer, parseJobBody } from "./server";

const SECRET = "s".repeat(40);
const quiet = () => undefined;

function job(name: string, run: () => Promise<JobOutcome>, dedupeWindowMs = 0): JobDefinition {
  return { name, description: name, dedupeWindowMs, run };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("log redaction", () => {
  it("redacts sensitive keys and scrubs emails, phones and tokens in strings", () => {
    const out = redact({
      email: "a@b.com",
      secret: "x",
      brief: "my idea",
      note: "mail a@b.co or call +974 3366 4265, Bearer abc.def",
      nested: { authorization: "Bearer zzz", count: 3 },
    }) as Record<string, unknown>;
    expect(out.email).toBe("[redacted]");
    expect(out.secret).toBe("[redacted]");
    expect(out.brief).toBe("[redacted]");
    expect(out.note).toBe("mail [email] or call [number], Bearer [redacted]");
    expect(out.nested).toEqual({ authorization: "[redacted]", count: 3 });
  });

  it("writes one JSON line", () => {
    const line = formatLine("info", "job done", { job: "x", ms: 5 }, new Date("2026-11-10T00:00:00Z"));
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toEqual({ t: "2026-11-10T00:00:00.000Z", level: "info", msg: "job done", job: "x", ms: 5 });
  });
});

describe("job registry", () => {
  it("rejects bad and duplicate names", () => {
    const ok = async () => ({ status: 200, body: {} });
    expect(() => defineRegistry([job("Bad Name", ok)])).toThrow(/invalid job name/);
    expect(() => defineRegistry([job("a-job", ok), job("a-job", ok)])).toThrow(/duplicate/);
    expect([...defineRegistry([job("a-job", ok), job("b-job", ok)]).keys()]).toEqual(["a-job", "b-job"]);
  });
});

describe("runner", () => {
  const base = { log: quiet, siteUrl: "https://example.test", purge: async (t: readonly string[]) => [...t] };

  it("never runs a job twice at once (overlap guard)", async () => {
    const gate = deferred<JobOutcome>();
    let calls = 0;
    const runner = createJobRunner({
      ...base,
      registry: defineRegistry([
        job("slow", () => {
          calls++;
          return gate.promise;
        }),
      ]),
    });
    const first = runner.run("slow", "schedule");
    expect(runner.isRunning("slow")).toBe(true);
    const second = await runner.run("slow", "http");
    expect(second.kind).toBe("busy");
    gate.resolve({ status: 200, body: { done: true } });
    const r = await first;
    expect(r.kind).toBe("done");
    expect(calls).toBe(1);
    expect(runner.isRunning("slow")).toBe(false);
    // Free again after it finished.
    expect((await runner.run("slow", "http")).kind).toBe("done");
  });

  it("answers unknown jobs and turns a throw into a 500 outcome", async () => {
    const runner = createJobRunner({
      ...base,
      registry: defineRegistry([
        job("boom", async () => {
          throw new Error("x");
        }),
      ]),
    });
    expect((await runner.run("nope", "http")).kind).toBe("unknown");
    const r = await runner.run("boom", "http");
    expect(r.kind === "done" && r.outcome).toEqual({ status: 500, body: { error: "job_failed" } });
    expect(runner.isRunning("boom")).toBe(false);
    expect(runner.lastRuns().boom?.ok).toBe(false);
  });

  it("de-duplicates a Vercel-forwarded run right after a successful one, unless forced", async () => {
    let t = Date.parse("2026-11-10T02:00:00Z");
    let calls = 0;
    const runner = createJobRunner({
      ...base,
      now: () => new Date(t),
      registry: defineRegistry([
        job(
          "daily",
          async () => {
            calls++;
            return { status: 200, body: { n: calls } };
          },
          6 * 3600_000,
        ),
      ]),
    });
    await runner.run("daily", "schedule");
    t += 30 * 60_000;
    const again = await runner.run("daily", "vercel-cron");
    expect(again.kind).toBe("deduped");
    expect(again.kind === "deduped" && again.outcome.body).toEqual({ n: 1 });
    expect((await runner.run("daily", "vercel-cron", { force: true })).kind).toBe("done");
    expect((await runner.run("daily", "http")).kind).toBe("done"); // manual runs are never deduped
    t += 7 * 3600_000;
    expect((await runner.run("daily", "vercel-cron")).kind).toBe("done");
    expect(calls).toBe(4);
  });

  it("does not de-duplicate after a failed run", async () => {
    let calls = 0;
    const runner = createJobRunner({
      ...base,
      registry: defineRegistry([job("flaky", async () => ({ status: ++calls === 1 ? 500 : 200, body: {} }), 3600_000)]),
    });
    await runner.run("flaky", "schedule");
    expect((await runner.run("flaky", "vercel-cron")).kind).toBe("done");
  });
});

describe("parseJobBody", () => {
  it("accepts empty and known fields only", () => {
    expect(parseJobBody("")).toEqual({});
    expect(parseJobBody('{"force":true,"source":"vercel-cron","x":1}')).toEqual({ force: true, source: "vercel-cron" });
    expect(parseJobBody('{"force":"yes"}')).toEqual({ force: false, source: undefined });
    expect(() => parseJobBody("[1]")).toThrow();
    expect(() => parseJobBody("{")).toThrow();
  });
});

describe("HTTP surface", () => {
  let url = "";
  const lines: string[] = [];
  const server = createWorkerServer({
    secret: SECRET,
    log: (level, msg, fields) => lines.push(formatLine(level, msg, fields)),
    version: "abc1234",
    startedAt: Date.now(),
    maxBodyBytes: 256,
    runner: createJobRunner({
      log: quiet,
      siteUrl: "https://example.test",
      purge: async (t) => [...t],
      registry: defineRegistry([job("echo-job", async () => ({ status: 207, body: { hello: "world" } }))]),
    }),
  });

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  const post = (path: string, init: { auth?: string; body?: string; origin?: string } = {}) =>
    fetch(`${url}${path}`, {
      method: "POST",
      headers: {
        ...(init.auth ? { authorization: init.auth } : {}),
        ...(init.origin ? { origin: init.origin } : {}),
        "content-type": "application/json",
      },
      body: init.body,
    });

  it("healthz needs no secret and lists jobs", async () => {
    const r = await fetch(`${url}/healthz`);
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; version: string; uptime: number; jobs: Record<string, unknown> };
    expect(j.ok).toBe(true);
    expect(j.version).toBe("abc1234");
    expect(j.jobs).toEqual({ "echo-job": null });
  });

  it("refuses a missing, wrong or prefix-only secret with 401", async () => {
    expect((await post("/jobs/echo-job")).status).toBe(401);
    expect((await post("/jobs/echo-job", { auth: `Bearer ${SECRET}x` })).status).toBe(401);
    expect((await post("/jobs/echo-job", { auth: `Bearer ${SECRET.slice(0, -1)}` })).status).toBe(401);
    expect((await post("/jobs/echo-job", { auth: SECRET })).status).toBe(401);
    // An unknown job is not revealed before auth.
    expect((await post("/jobs/whatever")).status).toBe(401);
  });

  it("runs a job and returns the envelope", async () => {
    const r = await post("/jobs/echo-job", { auth: `Bearer ${SECRET}`, body: '{"source":"vercel-cron"}' });
    expect(r.status).toBe(200);
    const j = (await r.json()) as Record<string, unknown>;
    expect(j).toMatchObject({ job: "echo-job", status: 207, body: { hello: "world" }, source: "vercel-cron" });
    expect(typeof j.run_id).toBe("string");
  });

  it("caps the body, rejects bad JSON and unknown jobs", async () => {
    expect((await post("/jobs/echo-job", { auth: `Bearer ${SECRET}`, body: JSON.stringify({ pad: "x".repeat(500) }) })).status).toBe(413);
    expect((await post("/jobs/echo-job", { auth: `Bearer ${SECRET}`, body: "{" })).status).toBe(400);
    expect((await post("/jobs/nope", { auth: `Bearer ${SECRET}` })).status).toBe(404);
    expect((await fetch(`${url}/jobs/echo-job`)).status).toBe(405);
  });

  it("allows only the two origins", async () => {
    const ok = await fetch(`${url}/healthz`, { headers: { origin: "https://gestaltung360.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://gestaltung360.com");
    const local = await fetch(`${url}/jobs/echo-job`, { method: "OPTIONS", headers: { origin: "http://localhost:3000" } });
    expect(local.status).toBe(204);
    expect(local.headers.get("access-control-allow-headers")).toContain("authorization");
    expect((await fetch(`${url}/healthz`, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await post("/jobs/echo-job", { auth: `Bearer ${SECRET}`, origin: "https://www.gestaltung360.com" })).status).toBe(403);
  });

  it("never logs the secret", () => {
    expect(lines.join("\n")).not.toContain(SECRET);
  });
});
