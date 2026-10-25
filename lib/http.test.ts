import { describe, expect, it } from "vitest";
import { z } from "zod";

import { emptyStatus, jsonError, jsonOk, parseJsonBody } from "@/lib/http";

const Body = z.object({ name: z.string().min(1), qty: z.number().int().optional() });

function post(body: BodyInit | null, headers: Record<string, string> = { "content-type": "application/json" }) {
  return new Request("http://localhost/api/x", { method: "POST", body, headers });
}

describe("response helpers", () => {
  it("jsonOk defaults to 200 and passes init through", async () => {
    const r = jsonOk({ ok: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    const c = jsonOk({ id: 1 }, { status: 201, headers: { "Cache-Control": "no-store" } });
    expect(c.status).toBe(201);
    expect(c.headers.get("cache-control")).toBe("no-store");
  });

  it("jsonError builds { error } with the status and optional extras", async () => {
    const r = jsonError("sign_in", 401);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "sign_in" });
    const e = jsonError("rate_limited", 429, { retryAfter: 30 });
    expect(e.status).toBe(429);
    expect(await e.json()).toEqual({ error: "rate_limited", retryAfter: 30 });
  });

  it("emptyStatus has no body", async () => {
    const r = emptyStatus(403);
    expect(r.status).toBe(403);
    expect(r.body).toBeNull();
    expect(await r.text()).toBe("");
    expect(emptyStatus(204).status).toBe(204);
  });
});

describe("parseJsonBody", () => {
  it("returns validated data", async () => {
    const out = await parseJsonBody(post(JSON.stringify({ name: "a", qty: 2 })), Body);
    expect(out).toEqual({ ok: true, data: { name: "a", qty: 2 } });
  });

  it("accepts a charset parameter on the content type", async () => {
    const out = await parseJsonBody(post(JSON.stringify({ name: "a" }), { "content-type": "Application/JSON; charset=utf-8" }), Body);
    expect(out.ok).toBe(true);
  });

  it("applies schema transforms/defaults", async () => {
    const S = z.object({ n: z.coerce.number() }).transform((v) => ({ n2: v.n * 2 }));
    const out = await parseJsonBody(post(JSON.stringify({ n: "4" })), S);
    expect(out).toEqual({ ok: true, data: { n2: 8 } });
  });

  async function failure(req: Request, opts?: { maxBytes?: number }) {
    const out = await parseJsonBody(req, Body, opts);
    if (out.ok) throw new Error("expected failure");
    return { status: out.response.status, body: await out.response.json() };
  }

  it("415 for a non-JSON content type or none", async () => {
    expect(await failure(post("{}", { "content-type": "text/plain" }))).toEqual({
      status: 415,
      body: { error: "unsupported_media_type" },
    });
    expect((await failure(post(JSON.stringify({ name: "a" }), {}))).status).toBe(415);
  });

  it("400 bad_request for invalid JSON, empty body and wrong shape", async () => {
    for (const body of ["{not json", "", "null", JSON.stringify({ name: "" }), JSON.stringify({ qty: 1 }), JSON.stringify([1])]) {
      expect(await failure(post(body))).toEqual({ status: 400, body: { error: "bad_request" } });
    }
  });

  it("413 when Content-Length is over the cap", async () => {
    const req = post(JSON.stringify({ name: "a" }), { "content-type": "application/json", "content-length": "5000" });
    expect(await failure(req, { maxBytes: 100 })).toEqual({ status: 413, body: { error: "too_large" } });
  });

  it("413 when the bytes read are over the cap even without a trustworthy header", async () => {
    const big = JSON.stringify({ name: "x".repeat(500) });
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const req = new Request("http://localhost/api/x", {
      method: "POST",
      body: stream,
      headers: { "content-type": "application/json" },
      // @ts-expect-error duplex is required by undici for stream bodies
      duplex: "half",
    });
    expect(await failure(req, { maxBytes: 100 })).toEqual({ status: 413, body: { error: "too_large" } });
  });

  it("counts bytes, not characters", async () => {
    const body = JSON.stringify({ name: "ع".repeat(60) }); // 60 chars, ~120 bytes of UTF-8
    expect((await failure(post(body), { maxBytes: 100 })).status).toBe(413);
    expect((await parseJsonBody(post(body), Body, { maxBytes: 200 })).ok).toBe(true);
  });

  it("default cap is 64 KiB", async () => {
    const body = JSON.stringify({ name: "x".repeat(70_000) });
    expect((await failure(post(body))).status).toBe(413);
  });
});
