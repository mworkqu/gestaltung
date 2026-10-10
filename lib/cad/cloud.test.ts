import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// google-auth-library is mocked: no Google API is ever called.
const calls = vi.hoisted(() => ({
  credentials: [] as unknown[],
  audiences: [] as string[],
  fetchAudiences: [] as string[],
}));

vi.mock("google-auth-library", () => ({
  GoogleAuth: class {
    constructor(opts: { credentials: unknown }) {
      calls.credentials.push(opts.credentials);
    }
    async getIdTokenClient(audience: string) {
      calls.audiences.push(audience);
      return {
        idTokenProvider: {
          fetchIdToken: async (aud: string) => {
            calls.fetchAudiences.push(aud);
            const exp = Math.floor(Date.now() / 1000) + 3600;
            const payload = Buffer.from(JSON.stringify({ aud, exp })).toString("base64url");
            return `h.${payload}.s`;
          },
        },
      };
    }
  },
}));

import {
  buildOnce,
  buildWithRetry,
  cloudAuthMode,
  cloudConfigured,
  cloudFailureCode,
  cloudUrl,
  idToken,
  nextCloudStep,
  repairMessages,
  resetCloudAuth,
  type BuildOutcome,
  type BuildResult,
} from "./cloud";

const KEY = { type: "service_account", client_email: "cad@example.iam.gserviceaccount.com", private_key: "x" };
const URL_ = "https://cad-worker-abc-ew.a.run.app";

const okBody = {
  ok: true,
  step_b64: "U1RFUA==",
  stl_b64: "U1RM",
  preview_svg: "<svg/>",
  bbox: { x: 80, y: 60, z: 30 },
  volume_mm3: 12345,
  checks: [
    { name: "min_wall", pass: true, detail: "thinnest wall 2.0 mm" },
    { name: "must_contain_box", pass: true, detail: "fits" },
  ],
  log: "built",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const req = { code: "import cadquery as cq\nresult = cq.Workplane().box(1, 1, 1)\n", minWallMm: 1.2, mustContainBox: null };

beforeEach(() => {
  resetCloudAuth();
  calls.credentials.length = 0;
  calls.audiences.length = 0;
  calls.fetchAudiences.length = 0;
  vi.stubEnv("GCP_CAD_URL", `${URL_}/`);
  vi.stubEnv("GCP_CAD_SA_KEY", JSON.stringify(KEY));
  vi.stubEnv("GCP_WIF_PROVIDER", "");
  vi.stubEnv("GCP_CAD_SA_EMAIL", "");
  vi.stubEnv("VERCEL_OIDC_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("configuration", () => {
  it("normalises the service URL (= the token audience)", () => {
    expect(cloudUrl()).toBe(URL_);
    expect(cloudConfigured()).toBe(true);
  });
  it("is off without the key or with a non-https URL", () => {
    vi.stubEnv("GCP_CAD_SA_KEY", "");
    expect(cloudConfigured()).toBe(false);
    vi.stubEnv("GCP_CAD_SA_KEY", JSON.stringify(KEY));
    vi.stubEnv("GCP_CAD_URL", "http://insecure.example");
    expect(cloudConfigured()).toBe(false);
  });
});

describe("ID token", () => {
  it("is minted for the service URL as audience, from the key in GCP_CAD_SA_KEY", async () => {
    const token = await idToken(URL_);
    expect(token.split(".")).toHaveLength(3);
    expect(calls.audiences).toEqual([URL_]);
    expect(calls.fetchAudiences).toEqual([URL_]);
    expect(calls.credentials[0]).toEqual(KEY);
  });
  it("accepts the key base64-encoded", async () => {
    vi.stubEnv("GCP_CAD_SA_KEY", Buffer.from(JSON.stringify(KEY)).toString("base64"));
    await idToken(URL_);
    expect(calls.credentials[0]).toEqual(KEY);
  });
  it("caches the client and the token", async () => {
    await idToken(URL_);
    await idToken(URL_);
    expect(calls.audiences).toHaveLength(1);
    expect(calls.fetchAudiences).toHaveLength(1);
  });
  it("sends the token as a Bearer header to /build", async () => {
    const fetchImpl = vi.fn(async () => json(okBody));
    await buildOnce(req, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_}/build`);
    expect((init.headers as Record<string, string>).authorization).toMatch(/^Bearer h\./);
    expect(JSON.parse(String(init.body))).toEqual({
      code: req.code,
      units: "mm",
      checks: { min_wall_mm: 1.2, must_contain_box: null },
    });
  });
});

describe("shared worker secret", () => {
  it("goes in X-Cad-Worker-Token, never in Authorization", async () => {
    const send = async () => {
      const fetchImpl = vi.fn(async () => json(okBody));
      await buildOnce(req, { fetchImpl: fetchImpl as unknown as typeof fetch });
      return (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    };
    expect((await send())["x-cad-worker-token"]).toBeUndefined();
    vi.stubEnv("CAD_WORKER_TOKEN", "s3cret");
    const headers = await send();
    expect(headers["x-cad-worker-token"]).toBe("s3cret");
    expect(headers.authorization.startsWith("Bearer h.")).toBe(true);
  });
});

describe("buildOnce", () => {
  it("parses a good answer", async () => {
    const r = await buildOnce(req, { fetchImpl: (async () => json(okBody)) as unknown as typeof fetch });
    expect(r.kind).toBe("result");
    if (r.kind === "result") {
      expect(r.result.ok).toBe(true);
      expect(r.result.bbox).toEqual({ x: 80, y: 60, z: 30 });
      expect(r.result.checks).toHaveLength(2);
    }
  });
  it("a build that ran and failed is a result, not down", async () => {
    const r = await buildOnce(req, {
      fetchImpl: (async () => json({ ok: false, error: "NameError: result", log: "trace", checks: [] }, 422)) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ kind: "result", result: { ok: false, error: "NameError: result" } });
  });
  it("times out → down (timeout)", async () => {
    const hang: typeof fetch = (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const r = await buildOnce(req, { fetchImpl: hang, timeoutMs: 20 });
    expect(r).toMatchObject({ kind: "down", reason: "timeout" });
  });
  it("5xx / 403 without the contract → down (refused)", async () => {
    const r = await buildOnce(req, { fetchImpl: (async () => new Response("no", { status: 503 })) as unknown as typeof fetch });
    expect(r).toMatchObject({ kind: "down", reason: "refused" });
  });
  it("network error → down (unreachable), and never echoes the key", async () => {
    const r = await buildOnce(req, {
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ kind: "down", reason: "unreachable" });
    expect(JSON.stringify(r)).not.toContain(KEY.client_email);
    expect(JSON.stringify(r)).not.toContain("Bearer");
  });
  it("not configured → down without a request", async () => {
    vi.stubEnv("GCP_CAD_URL", "");
    const fetchImpl = vi.fn();
    const r = await buildOnce(req, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r).toMatchObject({ kind: "down", reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("buildWithRetry + fallback decision", () => {
  it("retries once when down, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(okBody));
    const r = await buildWithRetry(req, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.kind).toBe("result");
  });
  it("worker down twice → down → fallback to the browser path", async () => {
    const fetchImpl = vi.fn(async () => new Response("unavailable", { status: 503 }));
    const r = await buildWithRetry(req, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(r.kind).toBe("down");
    expect(nextCloudStep(r)).toEqual({ action: "fallback" });
  });
  it("does not retry a build that ran", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: false, error: "bad", log: "" }));
    await buildWithRetry(req, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("nextCloudStep", () => {
  const result = (over: Partial<BuildResult> = {}): BuildOutcome => ({
    kind: "result",
    result: {
      ok: true,
      stepB64: "a",
      stlB64: "b",
      previewSvg: "<svg/>",
      bbox: { x: 1, y: 1, z: 1 },
      volumeMm3: 1,
      checks: [{ name: "min_wall", pass: true, detail: "" }],
      log: "",
      error: null,
      ...over,
    },
  });
  const failedBuild = result({ ok: false, error: "boom", stepB64: null });
  const failedCheck = result({ checks: [{ name: "must_contain_box", pass: false, detail: "inside 50 mm < 69 mm" }] });
  const down: BuildOutcome = { kind: "down", reason: "timeout", detail: "" };

  it("delivers a clean first build", () => expect(nextCloudStep(result())).toEqual({ action: "deliver", which: "first" }));
  it("repairs a failed build or a failed check", () => {
    expect(nextCloudStep(failedBuild)).toEqual({ action: "repair" });
    expect(nextCloudStep(failedCheck)).toEqual({ action: "repair" });
  });
  it("delivers the repair when it builds", () => expect(nextCloudStep(failedBuild, result())).toEqual({ action: "deliver", which: "second" }));
  it("never delivers a model with a failed check (ok stays true for min_wall / must_contain_box)", () => {
    expect(nextCloudStep(failedCheck, failedBuild)).toEqual({ action: "fail" });
    expect(nextCloudStep(failedBuild, failedCheck)).toEqual({ action: "fail" });
    expect(cloudFailureCode(failedCheck)).toBe("checks");
    expect(cloudFailureCode(failedBuild)).toBe("render");
  });
  it("a zero bbox (failed build) is no model", () =>
    expect(nextCloudStep(result({ bbox: { x: 0, y: 0, z: 0 } }))).toEqual({ action: "repair" }));
  it("falls back when the repair finds the worker down", () =>
    expect(nextCloudStep(failedCheck, down)).toEqual({ action: "fallback" }));
  it("fails (no charge) when neither builds", () => expect(nextCloudStep(failedBuild, failedBuild)).toEqual({ action: "fail" }));
  it("falls back when the repair finds the worker down and nothing was built", () =>
    expect(nextCloudStep(failedBuild, down)).toEqual({ action: "fallback" }));
  it("repair messages carry the error and the failed checks", () => {
    if (failedCheck.kind !== "result" || failedBuild.kind !== "result") throw new Error();
    expect(repairMessages(failedCheck.result)).toContain('Check "must_contain_box" failed: inside 50 mm < 69 mm');
    expect(repairMessages(failedBuild.result)).toContain("Build failed: boom");
  });
});

// ── Keyless: Vercel OIDC → Google STS → IAM Credentials generateIdToken ──────
const PROVIDER = "projects/1005108288584/locations/global/workloadIdentityPools/vercel/providers/vercel";
const SA = "vercel-cad-caller@gestaltung-cad.iam.gserviceaccount.com";
const VERCEL_JWT = "vercel.oidc.jwt";
const STS = "https://sts.googleapis.com/v1/token";
const IAM = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(SA)}:generateIdToken`;

const googleIdToken = (expSeconds = 3600) =>
  `g.${Buffer.from(JSON.stringify({ aud: URL_, exp: Math.floor(Date.now() / 1000) + expSeconds })).toString("base64url")}.s`;

/** Routes by URL: STS, IAM Credentials, then the worker. Records every call. */
function googleFetch(over: { sts?: () => Response; iam?: () => Response; worker?: () => Response } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === STS) return over.sts?.() ?? json({ access_token: "fed-access", token_type: "Bearer", expires_in: 3600 });
    if (url === IAM) return over.iam?.() ?? json({ token: googleIdToken() });
    return over.worker?.() ?? json(okBody);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("keyless Google auth (Workload Identity Federation)", () => {
  beforeEach(() => {
    vi.stubEnv("GCP_WIF_PROVIDER", PROVIDER);
    vi.stubEnv("GCP_CAD_SA_EMAIL", SA);
    vi.stubEnv("VERCEL_OIDC_TOKEN", VERCEL_JWT);
  });

  it("selection: keyless wins over a key; key alone = key; neither = not configured", () => {
    expect(cloudAuthMode()).toBe("keyless");
    vi.stubEnv("GCP_WIF_PROVIDER", "");
    expect(cloudAuthMode()).toBe("key");
    vi.stubEnv("GCP_CAD_SA_KEY", "");
    expect(cloudAuthMode()).toBeNull();
    expect(cloudConfigured()).toBe(false);
    vi.stubEnv("GCP_WIF_PROVIDER", PROVIDER);
    expect(cloudConfigured()).toBe(true);
  });

  it("exchanges the Vercel token at STS, then asks IAM for an ID token with the service URL as audience", async () => {
    const g = googleFetch();
    const r = await buildOnce(req, { fetchImpl: g.impl });
    expect(r.kind).toBe("result");
    expect(g.calls.map((c) => c.url)).toEqual([STS, IAM, `${URL_}/build`]);

    const [sts, iam, worker] = g.calls;
    expect(sts.init.method).toBe("POST");
    expect(JSON.parse(String(sts.init.body))).toEqual({
      grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience: `//iam.googleapis.com/${PROVIDER}`,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
      subjectToken: VERCEL_JWT,
      subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
    });
    expect((sts.init.headers as Record<string, string>).authorization).toBeUndefined();

    expect((iam.init.headers as Record<string, string>).authorization).toBe("Bearer fed-access");
    expect(JSON.parse(String(iam.init.body))).toEqual({ audience: URL_, includeEmail: true });

    expect((worker.init.headers as Record<string, string>).authorization).toMatch(/^Bearer g\./);
    // The key path is never touched.
    expect(calls.credentials).toHaveLength(0);
  });

  it("prefers the token passed from the request header over the env var", async () => {
    const g = googleFetch();
    await buildOnce(req, { fetchImpl: g.impl, oidcToken: "from-header" });
    expect(JSON.parse(String(g.calls[0].init.body)).subjectToken).toBe("from-header");
  });

  it("caches the ID token until 5 minutes before it expires", async () => {
    const g = googleFetch();
    await idToken(URL_, { fetchImpl: g.impl });
    await idToken(URL_, { fetchImpl: g.impl });
    expect(g.calls.filter((c) => c.url === STS)).toHaveLength(1);

    resetCloudAuth();
    const short = googleFetch({ iam: () => json({ token: googleIdToken(4 * 60) }) });
    await idToken(URL_, { fetchImpl: short.impl });
    await idToken(URL_, { fetchImpl: short.impl });
    expect(short.calls.filter((c) => c.url === STS)).toHaveLength(2);
  });

  it("STS failure → down (unreachable) → retried once → fallback to the browser path, no worker call, no token leaked", async () => {
    const g = googleFetch({ sts: () => json({ error: "invalid_grant", error_description: "bad" }, 400) });
    const r = await buildWithRetry(req, { fetchImpl: g.impl });
    expect(r).toMatchObject({ kind: "down", reason: "unreachable" });
    expect(r.kind === "down" && r.detail).toContain("sts HTTP 400 invalid_grant");
    expect(g.calls.filter((c) => c.url === STS)).toHaveLength(2);
    expect(g.calls.some((c) => c.url.startsWith(URL_))).toBe(false);
    expect(nextCloudStep(r)).toEqual({ action: "fallback" });
    expect(JSON.stringify(r)).not.toContain(VERCEL_JWT);
  });

  it("generateIdToken refused (403) → down (unreachable)", async () => {
    const g = googleFetch({ iam: () => json({ error: { code: 403, status: "PERMISSION_DENIED" } }, 403) });
    const r = await buildOnce(req, { fetchImpl: g.impl });
    expect(r).toMatchObject({ kind: "down", reason: "unreachable" });
    expect(r.kind === "down" && r.detail).toContain("generateIdToken HTTP 403 PERMISSION_DENIED");
    expect(JSON.stringify(r)).not.toContain("fed-access");
  });

  it("no Vercel OIDC token anywhere → down without calling Google", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const g = googleFetch();
    const r = await buildOnce(req, { fetchImpl: g.impl });
    expect(r).toMatchObject({ kind: "down", reason: "unreachable" });
    expect(g.calls).toHaveLength(0);
  });

  it("nothing configured → not_configured without a request", async () => {
    vi.stubEnv("GCP_WIF_PROVIDER", "");
    vi.stubEnv("GCP_CAD_SA_KEY", "");
    const g = googleFetch();
    const r = await buildOnce(req, { fetchImpl: g.impl });
    expect(r).toMatchObject({ kind: "down", reason: "not_configured" });
    expect(g.calls).toHaveLength(0);
  });
});
