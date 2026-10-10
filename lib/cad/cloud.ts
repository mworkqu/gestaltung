// The cloud CAD worker (Cloud Run, CadQuery) — server-only. NEVER import this
// from a "use client" file: it handles Google credentials.
//
//   POST {GCP_CAD_URL}/build  {code, units:"mm", checks:{min_wall_mm, must_contain_box}}
//     → {ok, step_b64, stl_b64, preview_svg, bbox, volume_mm3, checks, log, error?}
//   GET  {GCP_CAD_URL}/health
//
// The service is IAM-protected: every request carries a Google ID token whose
// audience is the service URL. Two ways to mint it (cloudAuthMode):
//   keyless (preferred) — GCP_WIF_PROVIDER + GCP_CAD_SA_EMAIL: the Vercel OIDC
//     token is exchanged at Google STS (Workload Identity Federation) for a
//     federated access token, which asks IAM Credentials for an ID token of the
//     service account. No key file exists (the Google org blocks SA keys).
//   key (legacy) — GCP_CAD_SA_KEY (raw JSON or base64 of it) via
//     google-auth-library.
// The ID token is cached per server instance until 5 min before it expires.
// Keys and tokens are never logged; error messages carry the HTTP status and
// Google's error code only.
//
// "Down" = the worker could not be reached, timed out (60 s), refused us
// (401/403/5xx), we could not get a token, or it answered something that is
// not the contract. A build that RAN and failed (ok:false, a check failed) is
// a result, not "down".

import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import type { Box3, CadCheck } from "./engine";

if (typeof window !== "undefined") throw new Error("lib/cad/cloud.ts is server-only");

export const CLOUD_BUILD_TIMEOUT_MS = 60_000;
export const GOOGLE_CALL_TIMEOUT_MS = 10_000;
const TOKEN_EARLY_MS = 5 * 60_000;

export const STS_URL = "https://sts.googleapis.com/v1/token";
export const iamIdTokenUrl = (email: string) =>
  `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(email)}:generateIdToken`;

/** The service URL without a trailing slash (= the token audience), or null when not configured. */
export function cloudUrl(): string | null {
  const raw = process.env.GCP_CAD_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export type CloudAuthMode = "keyless" | "key";

/** keyless (WIF provider + SA email) wins over a key; null = no credentials configured. */
export function cloudAuthMode(): CloudAuthMode | null {
  if (process.env.GCP_WIF_PROVIDER?.trim() && process.env.GCP_CAD_SA_EMAIL?.trim()) return "keyless";
  if (process.env.GCP_CAD_SA_KEY?.trim()) return "key";
  return null;
}

export function cloudConfigured(): boolean {
  return !!cloudUrl() && !!cloudAuthMode();
}

/** The key as an object: raw JSON, or base64 of it (easier to paste into Vercel). */
function credentials(): Record<string, unknown> {
  const raw = process.env.GCP_CAD_SA_KEY?.trim() ?? "";
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Never echo the value.
    throw new Error("GCP_CAD_SA_KEY is not valid service-account JSON");
  }
}

type TokenSource = { fetchIdToken: (audience: string) => Promise<string> };
let source: { audience: string; client: Promise<TokenSource> } | null = null;
let cached: { key: string; token: string; expires: number } | null = null;

/** Test hook: forget the cached client and token. */
export function resetCloudAuth() {
  source = null;
  cached = null;
}

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: number };
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    /* opaque token: fall through */
  }
  return Date.now() + 30 * 60_000;
}

type RequestContext = { get?: () => { headers?: Record<string, unknown> } | undefined };

/**
 * The Vercel OIDC token: one passed by the route (request header
 * x-vercel-oidc-token), else the current request's header through Vercel's
 * request context (what @vercel/functions getVercelOidcToken reads), else the
 * env var (set at build time, and by `vercel env pull` for local runs).
 */
export function vercelOidcToken(passed?: string | null): string | null {
  const direct = passed?.trim();
  if (direct) return direct;
  try {
    const ctx = (globalThis as unknown as Record<symbol, RequestContext | undefined>)[
      Symbol.for("@vercel/request-context")
    ]?.get?.();
    const header = ctx?.headers?.["x-vercel-oidc-token"];
    if (typeof header === "string" && header.trim()) return header.trim();
  } catch {
    /* no request context (local / tests) */
  }
  return process.env.VERCEL_OIDC_TOKEN?.trim() || null;
}

/** Google's error code from a failed answer, never the body itself. */
async function googleError(step: string, res: Response): Promise<Error> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  const err = body?.error;
  const code =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "status" in err
        ? String((err as { status: unknown }).status)
        : "";
  return new Error(`google auth: ${step} HTTP ${res.status}${code ? ` ${code.slice(0, 60)}` : ""}`);
}

async function googlePost(
  doFetch: typeof fetch,
  step: string,
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GOOGLE_CALL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error(`google auth: ${step} ${timedOut ? "timed out" : "unreachable"}`);
  }
  if (!res.ok) throw await googleError(step, res);
  return ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

type AuthOpts = { fetchImpl?: typeof fetch; oidcToken?: string | null };

/** Keyless: Vercel OIDC → STS federated access token → IAM Credentials generateIdToken. */
async function keylessIdToken(audience: string, opts: AuthOpts): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const provider = (process.env.GCP_WIF_PROVIDER ?? "").trim().replace(/^\/\/iam\.googleapis\.com\//, "");
  const email = (process.env.GCP_CAD_SA_EMAIL ?? "").trim();
  const subject = vercelOidcToken(opts.oidcToken);
  if (!subject) throw new Error("google auth: no Vercel OIDC token");
  const sts = await googlePost(doFetch, "sts", STS_URL, {
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    audience: `//iam.googleapis.com/${provider}`,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    subjectToken: subject,
    subjectTokenType: "urn:ietf:params:oauth:token-type:jwt",
  });
  const access = typeof sts.access_token === "string" ? sts.access_token : "";
  if (!access) throw new Error("google auth: sts answered without an access token");
  const id = await googlePost(
    doFetch,
    "generateIdToken",
    iamIdTokenUrl(email),
    { audience, includeEmail: true },
    { authorization: `Bearer ${access}` }
  );
  const token = typeof id.token === "string" ? id.token : "";
  if (!token) throw new Error("google auth: generateIdToken answered without a token");
  return token;
}

/** Legacy: the service-account key via google-auth-library. */
async function keyIdToken(audience: string): Promise<string> {
  if (!source || source.audience !== audience) {
    const auth = new GoogleAuth({ credentials: credentials() });
    const client = auth.getIdTokenClient(audience).then((c) => c.idTokenProvider as TokenSource);
    source = { audience, client };
    client.catch(() => {
      if (source?.client === client) source = null;
    });
  }
  return (await source.client).fetchIdToken(audience);
}

/** A Google ID token for the worker (audience = the service URL). Throws when none can be had. */
export async function idToken(audience: string, opts: AuthOpts = {}): Promise<string> {
  const mode = cloudAuthMode();
  if (!mode) throw new Error("google auth: not configured");
  const key = `${mode}|${audience}`;
  if (cached && cached.key === key && cached.expires - TOKEN_EARLY_MS > Date.now()) return cached.token;
  const token = mode === "keyless" ? await keylessIdToken(audience, opts) : await keyIdToken(audience);
  cached = { key, token, expires: tokenExpiry(token) };
  return token;
}

const Num = z.number().finite();
const BuildResponse = z.object({
  ok: z.boolean(),
  step_b64: z.string().nullish(),
  stl_b64: z.string().nullish(),
  preview_svg: z.string().nullish(),
  bbox: z.object({ x: Num, y: Num, z: Num }).nullish(),
  volume_mm3: Num.nullish(),
  checks: z
    .array(z.object({ name: z.string(), pass: z.boolean(), detail: z.string().nullish() }))
    .nullish(),
  log: z.string().nullish(),
  error: z.string().nullish(),
});

export type BuildRequest = { code: string; minWallMm: number; mustContainBox: Box3 | null };

export type BuildResult = {
  ok: boolean;
  stepB64: string | null;
  stlB64: string | null;
  previewSvg: string | null;
  bbox: Box3 | null;
  volumeMm3: number | null;
  checks: CadCheck[];
  log: string;
  error: string | null;
};

export type BuildOutcome =
  | { kind: "result"; result: BuildResult }
  | { kind: "down"; reason: "not_configured" | "timeout" | "unreachable" | "refused" | "bad_response"; detail: string };

/** A delivered model needs every file and a size; anything else counts as a failed build. */
export function usable(r: BuildResult): boolean {
  // On a failed build the worker sends a zero bbox: that is no model either.
  const sized = !!r.bbox && r.bbox.x > 0 && r.bbox.y > 0 && r.bbox.z > 0;
  return r.ok && !!r.stepB64 && !!r.stlB64 && !!r.previewSvg && sized;
}

/** Built AND every check passed (min_wall, must_contain_box … can fail while ok stays true). */
export function passes(r: BuildResult): boolean {
  return usable(r) && r.checks.every((c) => c.pass);
}

/**
 * Authorization carries the Google ID token (Cloud Run IAM). The worker's own
 * optional shared secret (env CAD_WORKER_TOKEN on both sides) goes in
 * X-Cad-Worker-Token, never in Authorization.
 */
export function workerHeaders(idTokenValue: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${idTokenValue}` };
  const shared = process.env.CAD_WORKER_TOKEN?.trim();
  if (shared) headers["x-cad-worker-token"] = shared;
  return headers;
}

export type BuildOpts = {
  timeoutMs?: number;
  /** Used for the worker AND the keyless Google calls (tests route by URL). */
  fetchImpl?: typeof fetch;
  /** The request's x-vercel-oidc-token header, when the route has it. */
  oidcToken?: string | null;
};

/** One call to /build. Never throws. */
export async function buildOnce(req: BuildRequest, opts: BuildOpts = {}): Promise<BuildOutcome> {
  const url = cloudUrl();
  if (!url || !cloudAuthMode())
    return {
      kind: "down",
      reason: "not_configured",
      detail: "GCP_CAD_URL and GCP_WIF_PROVIDER + GCP_CAD_SA_EMAIL (or GCP_CAD_SA_KEY) missing",
    };
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CLOUD_BUILD_TIMEOUT_MS);
  try {
    const token = await idToken(url, { fetchImpl: opts.fetchImpl, oidcToken: opts.oidcToken });
    const res = await doFetch(`${url}/build`, {
      method: "POST",
      headers: workerHeaders(token),
      body: JSON.stringify({
        code: req.code,
        units: "mm",
        checks: { min_wall_mm: req.minWallMm, must_contain_box: req.mustContainBox },
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    const parsed = BuildResponse.safeParse(body);
    if (!parsed.success) {
      if (res.status === 401 || res.status === 403 || res.status >= 500)
        return { kind: "down", reason: "refused", detail: `HTTP ${res.status}` };
      return { kind: "down", reason: "bad_response", detail: `HTTP ${res.status}: not the build contract` };
    }
    const d = parsed.data;
    return {
      kind: "result",
      result: {
        ok: d.ok,
        stepB64: d.step_b64 ?? null,
        stlB64: d.stl_b64 ?? null,
        previewSvg: d.preview_svg ?? null,
        bbox: d.bbox ?? null,
        volumeMm3: d.volume_mm3 ?? null,
        checks: (d.checks ?? []).map((c) => ({ name: c.name, pass: c.pass, detail: c.detail ?? "" })),
        log: (d.log ?? "").slice(-20_000),
        error: d.error ?? null,
      },
    };
  } catch (e) {
    if (controller.signal.aborted) return { kind: "down", reason: "timeout", detail: `no answer within ${Math.round((opts.timeoutMs ?? CLOUD_BUILD_TIMEOUT_MS) / 1000)} s` };
    // A token failure counts as "worker unavailable" too (retry, then the browser
    // path). The message of a fetch / auth error never contains a key or a token.
    return { kind: "down", reason: "unreachable", detail: e instanceof Error ? e.message.slice(0, 200) : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** /build with one retry when the worker is down; "down" only after two misses in a row. */
export async function buildWithRetry(req: BuildRequest, opts: BuildOpts = {}): Promise<BuildOutcome> {
  const first = await buildOnce(req, opts);
  if (first.kind === "result" || first.reason === "not_configured") return first;
  return buildOnce(req, opts);
}

/** The messages a repair prompt is fed: the worker's error and every failed check. */
export function repairMessages(r: BuildResult): string {
  const lines: string[] = [];
  if (!r.ok) lines.push(`Build failed: ${r.error || "no solid was produced"}`);
  else if (!usable(r)) lines.push("The build returned no STEP/STL/preview: the final shape in `result` must be one non-empty solid.");
  for (const c of r.checks) if (!c.pass) lines.push(`Check "${c.name}" failed: ${c.detail || "no detail"}`);
  const tail = r.log.trim().slice(-2000);
  if (tail && !r.ok) lines.push(`Worker log (end):\n${tail}`);
  return lines.join("\n");
}

export type CloudStep =
  | { action: "deliver"; which: "first" | "second" }
  | { action: "repair" }
  | { action: "fallback" }
  | { action: "fail" };

const clean = (o: BuildOutcome | undefined): o is { kind: "result"; result: BuildResult } =>
  o?.kind === "result" && passes(o.result);

/**
 * What to do after the first build (and, after the repair, the second). Only a
 * model that built AND passed every check is delivered (and so charged):
 *   first down                       → fallback to the browser path
 *   first clean                      → deliver it
 *   failed build OR any failed check → ONE repair (fed the error + check details)
 *   repair clean                     → deliver the repair
 *   repair down                      → fallback to the browser path
 *   repair still failing             → fail: nothing delivered, nothing charged
 * (ok stays true when only min_wall / must_contain_box fail, so the checks are
 * read on their own.)
 */
export function nextCloudStep(first: BuildOutcome, second?: BuildOutcome): CloudStep {
  if (first.kind === "down") return { action: "fallback" };
  if (!second) return clean(first) ? { action: "deliver", which: "first" } : { action: "repair" };
  if (clean(second)) return { action: "deliver", which: "second" };
  return second.kind === "down" ? { action: "fallback" } : { action: "fail" };
}

/** The error code a client sees when the repair still fails: the checks, or the build itself. */
export function cloudFailureCode(last: BuildOutcome): "checks" | "render" {
  return last.kind === "result" && usable(last.result) && !passes(last.result) ? "checks" : "render";
}
