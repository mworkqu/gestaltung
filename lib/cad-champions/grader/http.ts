// HTTP client for the STEP grader service (/grader, Cloud Run) — SERVER ONLY.
// Env: GRADER_URL (no trailing slash) and GRADER_SECRET (header X-Grader-Secret).
// 120 s timeout per call; one retry on a network error or a 5xx answer.
// Cloud Run is IAM-protected (no public invocation): when Google credentials are
// configured (same keyless WIF setup as the CAD worker) each attempt also sends
// Authorization: Bearer <ID token, audience = the service origin>. Without them
// (local dev) only the secret is sent. 401/403 from Cloud Run => "not_authorized".
// Responses are validated with zod. The raw JSON (with `details`) is returned
// for cc_grading_logs only; never pass it to a student.

import { z } from "zod";

import { googleIdTokenFor } from "@/lib/cad/cloud";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/grader/http.ts is server-only");

export const GRADER_TIMEOUT_MS = 120_000;
const RETRY_DELAY_MS = 1_000;

// ------------------------------------------------------------------ schemas

const CheckSchema = z.object({
  name: z.string(),
  measured: z.unknown().optional(),
  expected_hidden: z.boolean().optional(),
  passed: z.boolean(),
  partial: z.number(),
  aspect_key: z.string().nullable().optional(),
  points: z.number().optional(),
  max_points: z.number().optional(),
});

export const GradeResponseSchema = z.object({
  score: z.number(),
  max_points: z.number(),
  checks: z.array(CheckSchema),
  error_code: z.string().nullable(),
  warnings: z.array(z.string()).default([]),
  feedback_en: z.string(),
  feedback_ar: z.string(),
  help_slug: z.string().nullable().optional(),
  timing_ms: z.number().optional(),
  mode: z.string().optional(),
  scoring: z.string().optional(),
  passed: z.boolean(),
  practice_score: z.number().nullable().optional(),
  /** SERVER-SIDE ONLY: reference-relative data. */
  details: z.record(z.string(), z.unknown()).optional(),
});

export const PackageTaskResultSchema = GradeResponseSchema.extend({
  task_id: z.string(),
  file_name: z.string().nullable().optional(),
  matched_by: z.string().nullable().optional(),
  matched_by_volume: z.boolean().optional(),
});

export const GradePackageResponseSchema = z.object({
  submission_id: z.string(),
  results: z.array(PackageTaskResultSchema),
  unmatched_files: z.array(z.string()).default([]),
  ignored_files: z.array(z.string()).default([]),
  timing_ms: z.number().optional(),
});

export const ReferenceResponseSchema = z.object({
  reference_data: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string()).default([]),
  timing_ms: z.number().optional(),
});

export type GraderGradeResponse = z.infer<typeof GradeResponseSchema>;
export type GraderPackageTaskResult = z.infer<typeof PackageTaskResultSchema>;
export type GraderPackageResponse = z.infer<typeof GradePackageResponseSchema>;
export type GraderReferenceResponse = z.infer<typeof ReferenceResponseSchema>;

const SCHEMAS = {
  "/grade": GradeResponseSchema,
  "/grade-package": GradePackageResponseSchema,
  "/reference": ReferenceResponseSchema,
} as const;

export type GraderPath = keyof typeof SCHEMAS;
export type GraderResponseFor<P extends GraderPath> = z.infer<(typeof SCHEMAS)[P]>;

// ------------------------------------------------------------------ config

export interface GraderEnv {
  url: string | undefined;
  secret: string | undefined;
}

function readEnv(): GraderEnv {
  return { url: process.env.GRADER_URL, secret: process.env.GRADER_SECRET };
}

/** True when both GRADER_URL and GRADER_SECRET are set. */
export function graderConfigured(env: GraderEnv = readEnv()): boolean {
  return !!env.url?.trim() && !!env.secret?.trim();
}

// ------------------------------------------------------------------ call

export type GraderFailureKind = "not_configured" | "network" | "timeout" | "http" | "invalid_response" | "not_authorized";

export type GraderCallResult<T> =
  | { ok: true; data: T; raw: unknown; status: number; durationMs: number; tries: number }
  | {
      ok: false;
      kind: GraderFailureKind;
      /** Short, secret-free description for logs. */
      error: string;
      status?: number;
      raw?: unknown;
      durationMs: number;
      tries: number;
    };

export interface CallDeps {
  fetch?: typeof fetch;
  env?: GraderEnv;
  timeoutMs?: number;
  retryDelayMs?: number;
  /** Test hook; default = googleIdTokenFor (null when no Google credentials are configured). */
  idToken?: (audience: string) => Promise<string | null>;
}

type Attempt =
  | { kind: "response"; status: number; raw: unknown }
  | { kind: "network"; error: string }
  | { kind: "timeout"; error: string }
  | { kind: "auth"; error: string };

async function once(
  fetchImpl: typeof fetch,
  url: string,
  secret: string,
  body: unknown,
  timeoutMs: number,
  getToken: (audience: string) => Promise<string | null>
): Promise<Attempt> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Grader-Secret": secret };
  try {
    const idToken = await getToken(new URL(url).origin);
    if (idToken) headers.Authorization = `Bearer ${idToken}`;
  } catch (e) {
    // The message of a token failure never contains a token or key.
    return { kind: "auth", error: `could not get a Google ID token: ${e instanceof Error ? e.message.slice(0, 150) : "failed"}` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      raw = null;
    }
    return { kind: "response", status: res.status, raw };
  } catch (e) {
    if (controller.signal.aborted) return { kind: "timeout", error: `timed out after ${Math.round(timeoutMs / 1000)} s` };
    return { kind: "network", error: e instanceof Error ? e.message.slice(0, 200) : "network error" };
  } finally {
    clearTimeout(timer);
  }
}

function errorFrom(raw: unknown, status: number): string {
  if (raw && typeof raw === "object" && typeof (raw as { error?: unknown }).error === "string") {
    return `HTTP ${status}: ${String((raw as { error: string }).error).slice(0, 300)}`;
  }
  return `HTTP ${status}`;
}

/**
 * POSTs `body` to the grader. Retries once on a network error or a 5xx.
 * A timeout is not retried (the 120 s budget is already spent).
 */
export async function callGrader<P extends GraderPath>(path: P, body: unknown, deps: CallDeps = {}): Promise<GraderCallResult<GraderResponseFor<P>>> {
  const env = deps.env ?? readEnv();
  const started = Date.now();
  if (!graderConfigured(env)) return { ok: false, kind: "not_configured", error: "GRADER_URL / GRADER_SECRET not set", durationMs: 0, tries: 0 };
  const fetchImpl = deps.fetch ?? fetch;
  const url = `${env.url!.trim().replace(/\/+$/, "")}${path}`;
  const secret = env.secret!.trim();
  const timeoutMs = deps.timeoutMs ?? GRADER_TIMEOUT_MS;
  const retryDelay = deps.retryDelayMs ?? RETRY_DELAY_MS;
  const getToken = deps.idToken ?? ((audience: string) => googleIdTokenFor(audience));

  let tries = 0;
  let last: Attempt | null = null;
  while (tries < 2) {
    tries++;
    last = await once(fetchImpl, url, secret, body, timeoutMs, getToken);
    const retryable = last.kind === "network" || (last.kind === "response" && last.status >= 500);
    if (!retryable || tries >= 2) break;
    if (retryDelay > 0) await new Promise((r) => setTimeout(r, retryDelay));
  }
  const durationMs = Date.now() - started;
  const a = last!;
  if (a.kind === "timeout") return { ok: false, kind: "timeout", error: a.error, durationMs, tries };
  if (a.kind === "auth") return { ok: false, kind: "not_authorized", error: a.error, durationMs, tries };
  if (a.kind === "network") return { ok: false, kind: "network", error: a.error, durationMs, tries };
  if (a.status === 401 || a.status === 403) {
    // Cloud Run IAM refusal (HTML body) or the grader's own secret check (JSON).
    return { ok: false, kind: "not_authorized", status: a.status, error: `not authorized (HTTP ${a.status})`, raw: a.raw, durationMs, tries };
  }
  if (a.status < 200 || a.status >= 300) {
    return { ok: false, kind: "http", status: a.status, error: errorFrom(a.raw, a.status), raw: a.raw, durationMs, tries };
  }
  const parsed = SCHEMAS[path].safeParse(a.raw);
  if (!parsed.success) {
    return { ok: false, kind: "invalid_response", status: a.status, error: "response did not match the grader contract", raw: a.raw, durationMs, tries };
  }
  return { ok: true, data: parsed.data as GraderResponseFor<P>, raw: a.raw, status: a.status, durationMs, tries };
}
