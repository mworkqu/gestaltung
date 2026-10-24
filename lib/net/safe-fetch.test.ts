import { describe, expect, it, vi } from "vitest";

import { fetchWithinAllowList, readCapped } from "@/lib/net/safe-fetch";

const allowGoogle = (h: string) => h === "docs.google.com" || h.endsWith(".googleusercontent.com");

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

function route(map: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const key = String(url);
    const make = map[key];
    if (!make) throw new Error(`unexpected fetch ${key}`);
    return make();
  });
}

describe("fetchWithinAllowList", () => {
  it("follows allowed redirects and returns the body", async () => {
    const fetchImpl = route({
      "https://docs.google.com/sheet?output=csv": () => redirect("https://doc-1.googleusercontent.com/csv", 307),
      "https://doc-1.googleusercontent.com/csv": () => new Response("a,b\n1,2\n", { headers: { "content-type": "text/csv" } }),
    });
    const r = await fetchWithinAllowList("https://docs.google.com/sheet?output=csv", {
      allowHost: allowGoogle,
      maxBytes: 1000,
      fetchImpl,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new TextDecoder().decode(r.body)).toBe("a,b\n1,2\n");
      expect(r.url).toBe("https://doc-1.googleusercontent.com/csv");
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses a redirect to a host outside the allow-list without fetching it", async () => {
    const fetchImpl = route({
      "https://docs.google.com/x": () => redirect("http://169.254.169.254/latest/meta-data"),
    });
    const r = await fetchWithinAllowList("https://docs.google.com/x", { allowHost: allowGoogle, maxBytes: 1000, fetchImpl });
    expect(r).toEqual({ ok: false, error: "bad_url" });
    const fetch2 = route({ "https://docs.google.com/x": () => redirect("https://evil.example/") });
    const r2 = await fetchWithinAllowList("https://docs.google.com/x", { allowHost: allowGoogle, maxBytes: 1000, fetchImpl: fetch2 });
    expect(r2).toEqual({ ok: false, error: "bad_host" });
    expect(fetch2).toHaveBeenCalledTimes(1);
  });

  it("refuses a disallowed or non-https first URL without fetching", async () => {
    const fetchImpl = vi.fn();
    expect(await fetchWithinAllowList("https://evil.example/", { allowHost: allowGoogle, maxBytes: 1, fetchImpl })).toEqual({
      ok: false,
      error: "bad_host",
    });
    expect(await fetchWithinAllowList("http://docs.google.com/", { allowHost: allowGoogle, maxBytes: 1, fetchImpl })).toEqual({
      ok: false,
      error: "bad_url",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops after maxRedirects hops", async () => {
    const fetchImpl = vi.fn(async () => redirect("https://docs.google.com/loop"));
    const r = await fetchWithinAllowList("https://docs.google.com/loop", {
      allowHost: allowGoogle,
      maxBytes: 10,
      maxRedirects: 3,
      fetchImpl,
    });
    expect(r).toEqual({ ok: false, error: "too_many_redirects" });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses a body over the cap (declared or streamed)", async () => {
    const declared = route({
      "https://docs.google.com/big": () => new Response("x", { headers: { "content-length": "5000000" } }),
    });
    expect(await fetchWithinAllowList("https://docs.google.com/big", { allowHost: allowGoogle, maxBytes: 1000, fetchImpl: declared })).toEqual({
      ok: false,
      error: "too_large",
      status: 200,
    });

    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(400));
      },
    });
    const streamed = route({ "https://docs.google.com/big": () => new Response(endless) });
    const r = await fetchWithinAllowList("https://docs.google.com/big", { allowHost: allowGoogle, maxBytes: 1000, fetchImpl: streamed });
    expect(r).toMatchObject({ ok: false, error: "too_large" });
    expect(pulled).toBeLessThan(10);
  });

  it("reports non-2xx, accept() refusals and network errors", async () => {
    const notFound = route({ "https://docs.google.com/a": () => new Response("no", { status: 404 }) });
    expect(await fetchWithinAllowList("https://docs.google.com/a", { allowHost: allowGoogle, maxBytes: 10, fetchImpl: notFound })).toEqual({
      ok: false,
      error: "http_error",
      status: 404,
    });
    const html = route({ "https://docs.google.com/a": () => new Response("<p>", { headers: { "content-type": "text/html" } }) });
    expect(
      await fetchWithinAllowList("https://docs.google.com/a", {
        allowHost: allowGoogle,
        maxBytes: 10,
        fetchImpl: html,
        accept: (res) => res.headers.get("content-type") === "text/csv",
      })
    ).toEqual({ ok: false, error: "rejected", status: 200 });
    const boom = vi.fn(async () => {
      throw new TypeError("network");
    });
    expect(await fetchWithinAllowList("https://docs.google.com/a", { allowHost: allowGoogle, maxBytes: 10, fetchImpl: boom })).toEqual({
      ok: false,
      error: "fetch_failed",
    });
  });
});

describe("readCapped", () => {
  it("returns the bytes at or under the cap and null above it", async () => {
    expect(await readCapped(new Response("12345"), 5)).toEqual(new TextEncoder().encode("12345"));
    expect(await readCapped(new Response("123456"), 5)).toBeNull();
  });
});
