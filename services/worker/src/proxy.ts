// Part B: the worker forwards CAD builds and CAD Champions grading calls to
// the two containers on the Mac's private docker networks (docs/WORKER.md,
// "Part B"). Vercel calls these with Authorization: Bearer WORKER_SECRET only;
// the worker adds each container's own secret from ITS env, so Vercel never
// needs the Mac's CAD_WORKER_TOKEN / GRADER_SECRET.
//
//   POST /cad/build              -> {CAD_WORKER_URL}/build       60 s   X-Cad-Worker-Token (if set)
//   POST /grader/grade           -> {GRADER_URL}/grade          120 s   X-Grader-Secret
//   POST /grader/grade-package   -> {GRADER_URL}/grade-package  120 s   X-Grader-Secret
//   POST /grader/reference       -> {GRADER_URL}/reference      120 s   X-Grader-Secret
//
// The bodies are the exact JSON Vercel sends to Cloud Run today: CadQuery code
// (under 20 KB) or grader JSON whose STEP files travel as signed URLs (the
// grader downloads them itself), so 1 MiB is far more than any real request.
//
// The container's answer (status + JSON body) is passed through unchanged with
// "x-worker-upstream: <cad-worker|grader>". When the worker itself could not
// get an answer it says so with "x-worker-proxy-error":
//   upstream_not_configured  503  the URL is not set: nothing ran
//   upstream_unreachable     502  connection refused / no such host: nothing ran
//   upstream_timeout         504  no answer in time: it MAY have run
//   upstream_error           502  the connection broke after sending: it MAY have run
//   upstream_too_large       502  answer over the cap: it ran
// Vercel falls back to Cloud Run only when nothing ran (lib/worker/proxy.ts).

export type ProxyTargetName = "cad" | "grader";

export type ProxyRoute = { path: string; target: ProxyTargetName; upstreamPath: string; timeoutMs: number };

export const PROXY_MAX_BODY_BYTES = 1024 * 1024;
/** Cloud Run caps answers at 32 MiB and the CAD container keeps its files under 30 MiB. */
export const PROXY_MAX_ANSWER_BYTES = 40 * 1024 * 1024;
export const CAD_PROXY_TIMEOUT_MS = 60_000;
export const GRADER_PROXY_TIMEOUT_MS = 120_000;
const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_CACHE_MS = 30_000;

export const PROXY_ROUTES: readonly ProxyRoute[] = [
  { path: "/cad/build", target: "cad", upstreamPath: "/build", timeoutMs: CAD_PROXY_TIMEOUT_MS },
  { path: "/grader/grade", target: "grader", upstreamPath: "/grade", timeoutMs: GRADER_PROXY_TIMEOUT_MS },
  { path: "/grader/grade-package", target: "grader", upstreamPath: "/grade-package", timeoutMs: GRADER_PROXY_TIMEOUT_MS },
  { path: "/grader/reference", target: "grader", upstreamPath: "/reference", timeoutMs: GRADER_PROXY_TIMEOUT_MS },
];

export function proxyRouteFor(path: string): ProxyRoute | null {
  return PROXY_ROUTES.find((r) => r.path === path) ?? null;
}

export type ProxyConfig = {
  cadUrl: string | null;
  graderUrl: string | null;
  cadToken: string | null;
  graderSecret: string | null;
};

const clean = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

/** Defaults are the compose service names (services/compose.yaml). */
export function proxyConfigFromEnv(env: Record<string, string | undefined> = process.env): ProxyConfig {
  return {
    cadUrl: (clean(env.CAD_WORKER_URL) ?? "http://cad-worker:8080").replace(/\/+$/, ""),
    graderUrl: (clean(env.GRADER_URL) ?? "http://grader:8080").replace(/\/+$/, ""),
    cadToken: clean(env.CAD_WORKER_TOKEN),
    graderSecret: clean(env.GRADER_SECRET),
  };
}

export type ProxyErrorCode = "upstream_not_configured" | "upstream_unreachable" | "upstream_timeout" | "upstream_error" | "upstream_too_large";

export type ProxyAnswer =
  | { kind: "upstream"; status: number; body: Buffer; contentType: string }
  | { kind: "error"; status: number; code: ProxyErrorCode };

export type UpstreamState = "up" | "down" | "unknown";

export type Proxy = {
  forward(route: ProxyRoute, body: Buffer): Promise<ProxyAnswer>;
  /** Last known upstream health (refreshed in the background, at most every 30 s). */
  upstreams(): Record<ProxyTargetName, UpstreamState>;
};

/** Errors that prove the request never reached the container. */
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH"]);

function causeCode(e: unknown): string {
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur && typeof cur === "object"; i++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return "";
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

async function readCapped(res: Response, max: number): Promise<Buffer | null> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export type ProxyOptions = {
  config: ProxyConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  maxAnswerBytes?: number;
};

export function createProxy(opts: ProxyOptions): Proxy {
  const doFetch = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const maxAnswer = opts.maxAnswerBytes ?? PROXY_MAX_ANSWER_BYTES;
  const { config } = opts;

  const base = (t: ProxyTargetName) => (t === "cad" ? config.cadUrl : config.graderUrl);
  const headersFor = (t: ProxyTargetName): Record<string, string> => {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (t === "cad" && config.cadToken) h["x-cad-worker-token"] = config.cadToken;
    if (t === "grader" && config.graderSecret) h["x-grader-secret"] = config.graderSecret;
    return h;
  };

  const state: Record<ProxyTargetName, UpstreamState> = { cad: "unknown", grader: "unknown" };
  let checkedAt = -Infinity;
  let checking = false;

  async function probe(t: ProxyTargetName): Promise<UpstreamState> {
    const b = base(t);
    if (!b) return "down";
    try {
      const res = await doFetch(`${b}/health`, { method: "GET", signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      await res.body?.cancel().catch(() => undefined);
      return res.ok ? "up" : "down";
    } catch {
      return "down";
    }
  }

  function upstreams(): Record<ProxyTargetName, UpstreamState> {
    if (!checking && now() - checkedAt >= HEALTH_CACHE_MS) {
      checking = true;
      checkedAt = now();
      void Promise.all([probe("cad"), probe("grader")])
        .then(([c, g]) => {
          state.cad = c;
          state.grader = g;
        })
        .finally(() => {
          checking = false;
        });
    }
    return { ...state };
  }

  async function forward(route: ProxyRoute, body: Buffer): Promise<ProxyAnswer> {
    const b = base(route.target);
    if (!b) return { kind: "error", status: 503, code: "upstream_not_configured" };
    let res: Response;
    try {
      res = await doFetch(`${b}${route.upstreamPath}`, {
        method: "POST",
        headers: headersFor(route.target),
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(route.timeoutMs),
      });
    } catch (e) {
      if (isTimeout(e)) return { kind: "error", status: 504, code: "upstream_timeout" };
      if (NOT_SENT.has(causeCode(e))) {
        state[route.target] = "down";
        return { kind: "error", status: 502, code: "upstream_unreachable" };
      }
      return { kind: "error", status: 502, code: "upstream_error" };
    }
    let answer: Buffer | null;
    try {
      answer = await readCapped(res, maxAnswer);
    } catch (e) {
      return isTimeout(e) ? { kind: "error", status: 504, code: "upstream_timeout" } : { kind: "error", status: 502, code: "upstream_error" };
    }
    if (!answer) return { kind: "error", status: 502, code: "upstream_too_large" };
    state[route.target] = "up";
    return { kind: "upstream", status: res.status, body: answer, contentType: res.headers.get("content-type") ?? "application/json" };
  }

  return { forward, upstreams };
}
