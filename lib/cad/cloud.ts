// The cloud CAD worker (Cloud Run, CadQuery) — server-only. NEVER import this
// from a "use client" file: it reads the service-account key.
//
//   POST {GCP_CAD_URL}/build  {code, units:"mm", checks:{min_wall_mm, must_contain_box}}
//     → {ok, step_b64, stl_b64, preview_svg, bbox, volume_mm3, checks, log, error?}
//   GET  {GCP_CAD_URL}/health
//
// The service is IAM-protected: every request carries a Google ID token whose
// audience is the service URL, minted from the service-account JSON in
// GCP_CAD_SA_KEY (raw JSON or base64 of it). The auth client and the token are
// cached per server instance (a token lives about an hour; renewed 5 min
// early). The key and the token are never logged.
//
// "Down" = the worker could not be reached, timed out (60 s), refused us
// (401/403/5xx) or answered something that is not the contract. A build that
// RAN and failed (ok:false, a check failed) is a result, not "down".

import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

import type { Box3, CadCheck } from "./engine";

if (typeof window !== "undefined") throw new Error("lib/cad/cloud.ts is server-only");

export const CLOUD_BUILD_TIMEOUT_MS = 60_000;
const TOKEN_EARLY_MS = 5 * 60_000;

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

export function cloudConfigured(): boolean {
  return !!cloudUrl() && !!process.env.GCP_CAD_SA_KEY?.trim();
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
let cached: { audience: string; token: string; expires: number } | null = null;

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

/** A Google ID token for the worker (audience = the service URL). */
export async function idToken(audience: string): Promise<string> {
  if (cached && cached.audience === audience && cached.expires - TOKEN_EARLY_MS > Date.now()) return cached.token;
  if (!source || source.audience !== audience) {
    const auth = new GoogleAuth({ credentials: credentials() });
    const client = auth.getIdTokenClient(audience).then((c) => c.idTokenProvider as TokenSource);
    source = { audience, client };
    client.catch(() => {
      if (source?.client === client) source = null;
    });
  }
  const token = await (await source.client).fetchIdToken(audience);
  cached = { audience, token, expires: tokenExpiry(token) };
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

/** One call to /build. Never throws. */
export async function buildOnce(
  req: BuildRequest,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<BuildOutcome> {
  const url = cloudUrl();
  if (!url || !process.env.GCP_CAD_SA_KEY?.trim()) return { kind: "down", reason: "not_configured", detail: "GCP_CAD_URL / GCP_CAD_SA_KEY missing" };
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? CLOUD_BUILD_TIMEOUT_MS);
  try {
    const token = await idToken(url);
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
    // The message of a fetch / auth error never contains the key or the token.
    return { kind: "down", reason: "unreachable", detail: e instanceof Error ? e.message.slice(0, 200) : "request failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** /build with one retry when the worker is down; "down" only after two misses in a row. */
export async function buildWithRetry(
  req: BuildRequest,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<BuildOutcome> {
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
