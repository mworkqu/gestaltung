// Outbound fetch with a host allow-list that holds on every redirect hop and a
// hard byte cap on the body (audit API-08 / WEB-05).
//
// Plain fetch() follows redirects to any host (an allowed host with an open
// redirect lets the server fetch anything) and text()/arrayBuffer() buffer the
// whole body before a size check. Here redirects are followed by hand
// (redirect: "manual"), each Location is re-validated (https + allowHost), and
// the body is streamed and abandoned as soon as it passes maxBytes.
//
// Pure apart from the injected fetch, so it is unit-tested without a network.

export type SafeFetchError =
  | "bad_url" // not a URL, or not https
  | "bad_host" // first URL or a redirect target outside the allow-list
  | "too_many_redirects"
  | "http_error" // final response not 2xx
  | "rejected" // the caller's accept() said no (e.g. content type)
  | "too_large"
  | "fetch_failed"; // network error / timeout

export type SafeFetchResult =
  | { ok: true; url: string; status: number; headers: Headers; body: Uint8Array }
  | { ok: false; error: SafeFetchError; status?: number };

export type SafeFetchOptions = {
  /** True when this hostname (lower-case, no port) may be fetched. */
  allowHost: (host: string) => boolean;
  maxBytes: number;
  /** Redirect hops followed after the first request (default 3). */
  maxRedirects?: number;
  /** Covers every hop and the body read (default 15 s). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Extra request options (headers, cache). Method is always GET. */
  init?: Omit<RequestInit, "redirect" | "signal" | "method" | "body">;
  /** Checked on the final response before its body is read. */
  accept?: (res: Response) => boolean;
};

const REDIRECT = new Set([301, 302, 303, 307, 308]);

function checkUrl(raw: string | URL, allowHost: (host: string) => boolean): URL | "bad_url" | "bad_host" {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "bad_url";
  }
  if (u.protocol !== "https:") return "bad_url";
  if (!allowHost(u.hostname.toLowerCase())) return "bad_host";
  return u;
}

async function discard(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => {});
}

/**
 * Reads a response body, giving up (null) once it is larger than maxBytes.
 * A declared content-length over the cap is refused without reading.
 */
export async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(res);
    return null;
  }
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function fetchWithinAllowList(url: string | URL, opts: SafeFetchOptions): Promise<SafeFetchResult> {
  const { allowHost, maxBytes, maxRedirects = 3, timeoutMs = 15_000, fetchImpl = fetch, init, accept } = opts;

  const first = checkUrl(url, allowHost);
  if (typeof first === "string") return { ok: false, error: first };

  const signal = AbortSignal.timeout(timeoutMs);
  let current = first;
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(current.toString(), { ...init, method: "GET", redirect: "manual", signal });

      if (REDIRECT.has(res.status)) {
        await discard(res);
        if (hop >= maxRedirects) return { ok: false, error: "too_many_redirects" };
        const location = res.headers.get("location");
        if (!location) return { ok: false, error: "http_error", status: res.status };
        let target: string;
        try {
          target = new URL(location, current).toString();
        } catch {
          return { ok: false, error: "bad_url" };
        }
        const next = checkUrl(target, allowHost);
        if (typeof next === "string") return { ok: false, error: next };
        current = next;
        continue;
      }

      if (!res.ok) {
        await discard(res);
        return { ok: false, error: "http_error", status: res.status };
      }
      if (accept && !accept(res)) {
        await discard(res);
        return { ok: false, error: "rejected", status: res.status };
      }
      const body = await readCapped(res, maxBytes);
      if (!body) return { ok: false, error: "too_large", status: res.status };
      return { ok: true, url: current.toString(), status: res.status, headers: res.headers, body };
    }
  } catch {
    return { ok: false, error: "fetch_failed" };
  }
}
