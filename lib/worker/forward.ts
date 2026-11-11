// Forward a cron run to the worker: POST <WORKER_URL>/jobs/<name> with
// Authorization: Bearer WORKER_SECRET and {"source": "vercel-cron"}. Pure
// apart from the injected fetch; no Next imports.
//
// Outcomes and what the cron route does with them (lib/cron/route.ts):
//   ok       the worker ran it (or answered from a run minutes ago): return its status + body
//   busy     409, the job is running on the worker right now: answer 409, do NOT run it here too
//   timeout  no answer in time: the job may still be running there, so do NOT run it here
//            (answer 504); a timeout counts as a health failure
//   failed   not accepted (connection refused, tunnel error page, 401, 404, 5xx,
//            malformed answer): run the old in-Vercel path

export type ForwardResult =
  | { kind: "ok"; status: number; body: unknown; deduped: boolean }
  | { kind: "busy" }
  | { kind: "timeout" }
  | { kind: "failed"; reason: string };

export type ForwardOptions = {
  url: string;
  secret: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

type Envelope = { status: number; body: unknown; deduped?: boolean };

function isEnvelope(v: unknown): v is Envelope {
  if (!v || typeof v !== "object") return false;
  const s = (v as Record<string, unknown>).status;
  return typeof s === "number" && Number.isInteger(s) && s >= 100 && s <= 599 && "body" in v;
}

export async function forwardCronJob(name: string, opts: ForwardOptions): Promise<ForwardResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${opts.url.replace(/\/+$/, "")}/jobs/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.secret}`, "content-type": "application/json" },
      body: JSON.stringify({ source: "vercel-cron" }),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (e) {
    const n = e instanceof Error ? e.name : "";
    if (n === "TimeoutError" || n === "AbortError") return { kind: "timeout" };
    return { kind: "failed", reason: "network" };
  }
  if (res.status === 409) return { kind: "busy" };
  if (res.status !== 200) return { kind: "failed", reason: `http_${res.status}` };
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    const n = e instanceof Error ? e.name : "";
    if (n === "TimeoutError" || n === "AbortError") return { kind: "timeout" };
    return { kind: "failed", reason: "bad_json" };
  }
  if (!isEnvelope(body)) return { kind: "failed", reason: "bad_envelope" };
  return { kind: "ok", status: body.status, body: body.body, deduped: body.deduped === true };
}
