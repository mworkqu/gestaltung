// The worker switch on the cron routes (Phase 3A): off by default and then
// byte-for-byte the old behaviour with no outgoing request; on + healthy →
// forwarded; down / refused → the old in-Vercel path; busy / timeout → never
// run twice. fetch is a spy; Supabase and the job are stubs.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

const m = vi.hoisted(() => ({
  switchValue: null as unknown,
  switchReads: 0,
  runDeliveryPromiseReview: vi.fn(),
}));

vi.mock("next/cache", async (orig) => ({
  ...(await orig<typeof import("next/cache")>()),
  // Outside a Next server there is no incremental cache: call through.
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
  revalidateTag: vi.fn(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => {
          m.switchReads++;
          return { data: m.switchValue === null ? null : { value: m.switchValue }, error: null };
        },
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/contact-phone-server", () => ({ getContactPhone: async () => ({}) }));
vi.mock("@/lib/cron/delivery-promises", () => ({ runDeliveryPromiseReview: m.runDeliveryPromiseReview }));

import { GET } from "@/app/api/cron/delivery-promises/route";

const CRON = "cron-secret-for-tests";
const WSECRET = "w".repeat(40);
const LOCAL = { checked: 3, affected: [] };
let n = 0;
let fetchSpy: MockInstance<typeof fetch>;

const call = () => GET(new Request("https://gestaltung360.com/api/cron/delivery-promises", { headers: { authorization: `Bearer ${CRON}` } }));

function switchOn(url = `https://worker${++n}.example.com`) {
  vi.stubEnv("WORKER_URL", url);
  vi.stubEnv("WORKER_SECRET", WSECRET);
  m.switchValue = { enabled: true };
  return url;
}

function workerAnswers(job: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchSpy.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/healthz")) return Response.json({ ok: true, version: "x", uptime: 1, jobs: {} });
    return job(url, init);
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", CRON);
  m.switchValue = null;
  m.switchReads = 0;
  m.runDeliveryPromiseReview.mockReset().mockResolvedValue(LOCAL);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("unexpected fetch");
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fetchSpy.mockRestore();
});

describe("switch off (default): identical to before", () => {
  it("no WORKER_URL / WORKER_SECRET: runs here, no request, no switch read", async () => {
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(LOCAL);
    expect(r.headers.get("x-cron-runner")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.switchReads).toBe(0);
  });

  it("env set but the row is missing, false or malformed: runs here, no request", async () => {
    for (const v of [null, { enabled: false }, { enabled: "true" }, "on"]) {
      switchOn();
      m.switchValue = v;
      const r = await call();
      expect(await r.json()).toEqual(LOCAL);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
    expect(m.runDeliveryPromiseReview).toHaveBeenCalledTimes(4);
  });

  it("a short secret or a non-https URL counts as unset", async () => {
    vi.stubEnv("WORKER_URL", "http://worker.example.com");
    vi.stubEnv("WORKER_SECRET", WSECRET);
    m.switchValue = { enabled: true };
    await call();
    vi.stubEnv("WORKER_URL", "https://worker.example.com");
    vi.stubEnv("WORKER_SECRET", "short");
    await call();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(m.runDeliveryPromiseReview).toHaveBeenCalledTimes(2);
  });
});

describe("switch on", () => {
  it("healthy: forwards with the worker secret and returns the worker's answer", async () => {
    const url = switchOn();
    workerAnswers(() => Response.json({ job: "delivery-promises", run_id: "r", status: 200, body: { checked: 9, affected: ["x"] }, ms: 5 }));
    const r = await call();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ checked: 9, affected: ["x"] });
    expect(r.headers.get("x-cron-runner")).toBe("worker");
    expect(m.runDeliveryPromiseReview).not.toHaveBeenCalled();
    const jobCall = fetchSpy.mock.calls.find((c) => String(c[0]).endsWith("/jobs/delivery-promises"))!;
    expect(String(jobCall[0])).toBe(`${url}/jobs/delivery-promises`);
    expect(((jobCall[1] as RequestInit).headers as Record<string, string>).authorization).toBe(`Bearer ${WSECRET}`);
  });

  it("down (healthz fails twice): runs here without trying the job", async () => {
    switchOn();
    fetchSpy.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const r = await call();
    expect(await r.json()).toEqual(LOCAL);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.every((c) => String(c[0]).endsWith("/healthz"))).toBe(true);
    // Still down a moment later: no probe at all.
    await call();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("refused (401 / 5xx / tunnel error page): runs here", async () => {
    for (const status of [401, 502, 530]) {
      switchOn();
      workerAnswers(() => new Response("error", { status }));
      expect(await (await call()).json()).toEqual(LOCAL);
    }
    expect(m.runDeliveryPromiseReview).toHaveBeenCalledTimes(3);
  });

  it("busy: 409, not run here", async () => {
    switchOn();
    workerAnswers(() => Response.json({ error: "already_running" }, { status: 409 }));
    const r = await call();
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: "already_running" });
    expect(m.runDeliveryPromiseReview).not.toHaveBeenCalled();
  });

  it("accepted but no answer in time: 504, not run a second time here", async () => {
    switchOn();
    workerAnswers(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const r = await call();
    expect(r.status).toBe(504);
    expect(await r.json()).toEqual({ error: "worker_timeout" });
    expect(m.runDeliveryPromiseReview).not.toHaveBeenCalled();
  });
});
