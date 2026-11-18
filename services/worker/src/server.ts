// The worker's HTTP surface (plain node:http, no framework):
//   GET  /healthz       200 {ok, version, uptime, jobs}            no secret
//   POST /jobs/<name>   runs a registered job                       Bearer WORKER_SECRET
//   POST /cad/build, /grader/grade, /grader/grade-package, /grader/reference
//                       part B: forwarded to the private CAD containers  Bearer WORKER_SECRET
//                       (proxy.ts; body cap 1 MiB, the container's answer passed through)
//   OPTIONS *           CORS preflight (allowed origins only)
//
// POST /jobs/<name> answers 200 with an envelope {job, run_id, status, body,
// ms, source, deduped?}: `status` + `body` are exactly what the job's Vercel
// route would answer, so a Vercel cron route that forwarded the run can return
// them unchanged. 404 unknown job, 409 already running, 401 bad secret,
// 413 body over the cap, 400 bad JSON, 403 disallowed Origin.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { isAuthorizedCron } from "@/lib/auth/cron";

import type { Logger } from "./log";
import { PROXY_MAX_BODY_BYTES, proxyRouteFor, type Proxy, type ProxyRoute } from "./proxy";
import type { JobSource } from "./registry";
import type { JobRunner } from "./runner";

export const ALLOWED_ORIGINS = ["https://gestaltung360.com", "http://localhost:3000"] as const;
export const MAX_BODY_BYTES = 16 * 1024;

export type ServerOptions = {
  secret: string;
  runner: JobRunner;
  log: Logger;
  version: string;
  startedAt: number;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  now?: () => number;
  /** Part B: forwards /cad/* and /grader/* to the private containers. Absent = those paths 404. */
  proxy?: Proxy;
  proxyMaxBodyBytes?: number;
};

type JobRequestBody = { force?: boolean; source?: "vercel-cron" | "manual" };

class BodyError extends Error {
  constructor(readonly code: "too_large" | "bad_json") {
    super(code);
  }
}

function readBody(req: IncomingMessage, max: number): Promise<string> {
  return readBodyBytes(req, max).then((b) => b.toString("utf8"));
}

function readBodyBytes(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > max) {
      reject(new BodyError("too_large"));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let total = 0;
    let failed = false;
    req.on("data", (c: Buffer) => {
      if (failed) return;
      total += c.length;
      if (total > max) {
        failed = true;
        reject(new BodyError("too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on("error", (e) => {
      if (!failed) reject(e);
    });
  });
}

export function parseJobBody(raw: string): JobRequestBody {
  if (!raw.trim()) return {};
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    throw new BodyError("bad_json");
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new BodyError("bad_json");
  const o = v as Record<string, unknown>;
  return {
    force: o.force === true,
    source: o.source === "vercel-cron" ? "vercel-cron" : o.source === "manual" ? "manual" : undefined,
  };
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const json = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(json);
}

export function corsHeaders(origin: string | undefined, allowed: readonly string[]): Record<string, string> | null {
  if (!origin) return {};
  if (!allowed.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

type ProxyRequest = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  route: ProxyRoute;
  proxy: Proxy;
  secret: string;
  max: number;
  cors: Record<string, string>;
  log: Logger;
};

/** Part B: one forwarded call (auth, body cap, the container's answer or the proxy's error). Returns the status sent. */
async function handleProxy(p: ProxyRequest): Promise<number> {
  const { req, res, cors } = p;
  if (p.method !== "POST") {
    send(res, 405, { error: "method_not_allowed" }, { ...cors, allow: "POST" });
    return 405;
  }
  if (!isAuthorizedCron(req.headers.authorization, p.secret)) {
    req.resume();
    send(res, 401, { error: "unauthorized" }, cors);
    return 401;
  }
  let raw: Buffer;
  try {
    raw = await readBodyBytes(req, p.max);
    JSON.parse(raw.toString("utf8"));
  } catch (e) {
    if (e instanceof BodyError) {
      send(res, 413, { error: "too_large" }, cors);
      return 413;
    }
    if (e instanceof SyntaxError) {
      send(res, 400, { error: "bad_json" }, cors);
      return 400;
    }
    throw e;
  }
  const answer = await p.proxy.forward(p.route, raw);
  if (answer.kind === "error") {
    p.log("warn", "proxy failed", { path: p.path, upstream: p.route.target, code: answer.code });
    send(res, answer.status, { error: answer.code }, { ...cors, "x-worker-proxy-error": answer.code });
    return answer.status;
  }
  // The container's answer, unchanged (never logged: it carries files and grades).
  res.writeHead(answer.status, {
    "content-type": answer.contentType,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-worker-upstream": p.route.target === "cad" ? "cad-worker" : "grader",
    ...cors,
  });
  res.end(answer.body);
  return answer.status;
}

export function createWorkerHandler(opts: ServerOptions) {
  const allowed = opts.allowedOrigins ?? ALLOWED_ORIGINS;
  const max = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const proxyMax = opts.proxyMaxBodyBytes ?? PROXY_MAX_BODY_BYTES;
  const upstreams = () => (opts.proxy ? { upstreams: opts.proxy.upstreams() } : {});
  const now = opts.now ?? Date.now;

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = now();
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0]!;
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const cors = corsHeaders(origin, allowed);
    let status = 500;
    try {
      if (cors === null) {
        status = 403;
        return send(res, 403, { error: "origin_not_allowed" });
      }
      if (method === "OPTIONS") {
        status = 204;
        res.writeHead(204, cors);
        res.end();
        return;
      }
      if (path === "/healthz" && (method === "GET" || method === "HEAD")) {
        status = 200;
        return send(
          res,
          200,
          {
            ok: true,
            version: opts.version,
            uptime: Math.round((now() - opts.startedAt) / 1000),
            jobs: opts.runner.lastRuns(),
            ...upstreams(),
          },
          cors,
        );
      }
      const route = proxyRouteFor(path);
      if (route && opts.proxy) {
        status = await handleProxy({ req, res, method, path, route, proxy: opts.proxy, secret: opts.secret, max: proxyMax, cors, log: opts.log });
        return;
      }
      const m = /^\/jobs\/([^/]+)$/.exec(path);
      if (!m) {
        status = 404;
        return send(res, 404, { error: "not_found" }, cors);
      }
      if (method !== "POST") {
        status = 405;
        return send(res, 405, { error: "method_not_allowed" }, { ...cors, allow: "POST" });
      }
      if (!isAuthorizedCron(req.headers.authorization, opts.secret)) {
        status = 401;
        req.resume();
        return send(res, 401, { error: "unauthorized" }, cors);
      }
      let body: JobRequestBody;
      try {
        body = parseJobBody(await readBody(req, max));
      } catch (e) {
        if (e instanceof BodyError) {
          status = e.code === "too_large" ? 413 : 400;
          return send(res, status, { error: e.code }, cors);
        }
        throw e;
      }
      const name = decodeURIComponent(m[1]!);
      const source: JobSource = body.source === "vercel-cron" ? "vercel-cron" : "http";
      const result = await opts.runner.run(name, source, { force: body.force });
      if (result.kind === "unknown") {
        status = 404;
        return send(res, 404, { error: "unknown_job" }, cors);
      }
      if (result.kind === "busy") {
        status = 409;
        return send(res, 409, { error: "already_running", started_at: result.running.started_at }, cors);
      }
      status = 200;
      const run = result.kind === "done" ? result.run : result.last;
      return send(
        res,
        200,
        {
          job: name,
          run_id: run.run_id,
          status: result.outcome.status,
          body: result.outcome.body,
          ms: run.ms,
          source,
          ...(result.kind === "deduped" ? { deduped: true } : {}),
        },
        cors,
      );
    } catch (e) {
      status = 500;
      opts.log("error", "request failed", { method, path, error: e });
      if (!res.headersSent) send(res, 500, { error: "internal" });
      else res.end();
    } finally {
      // Path only: never the query string, headers or body.
      opts.log(status >= 500 ? "error" : "info", "http", { method, path, status, ms: now() - started });
    }
  };
}

export function createWorkerServer(opts: ServerOptions): Server {
  const handler = createWorkerHandler(opts);
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  // Jobs answer when they finish (a supplier refresh takes minutes).
  server.requestTimeout = 15 * 60_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
