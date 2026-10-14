import { describe, expect, it, vi } from "vitest";

import { callGrader, graderConfigured } from "./http";

const env = { url: "https://grader.example.run.app/", secret: "s3cret" };

const okBody = {
  score: 10,
  max_points: 10,
  checks: [{ name: "volume", measured: 125000, expected_hidden: true, passed: true, partial: 1 }],
  error_code: null,
  warnings: [],
  feedback_en: "Excellent",
  feedback_ar: "ممتاز",
  help_slug: null,
  timing_ms: 900,
  mode: "part",
  scoring: "aspects",
  passed: true,
  practice_score: null,
  details: { measured: { volume_mm3: 125000 } },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("graderConfigured", () => {
  it("needs both the URL and the secret", () => {
    expect(graderConfigured({ url: "https://x", secret: "y" })).toBe(true);
    expect(graderConfigured({ url: "https://x", secret: "" })).toBe(false);
    expect(graderConfigured({ url: undefined, secret: "y" })).toBe(false);
    expect(graderConfigured({ url: "  ", secret: " " })).toBe(false);
  });
});

describe("callGrader", () => {
  it("posts JSON with the secret header and parses the response", async () => {
    const fetchMock = vi.fn(async () => json(200, okBody));
    const res = await callGrader("/grade", { a: 1 }, { fetch: fetchMock as unknown as typeof fetch, env, retryDelayMs: 0 });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://grader.example.run.app/grade");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["X-Grader-Secret"]).toBe("s3cret");
    expect(JSON.parse(String(init.body))).toEqual({ a: 1 });
    if (res.ok) {
      expect(res.data.score).toBe(10);
      expect(res.tries).toBe(1);
    }
  });

  it("refuses to call without configuration", async () => {
    const fetchMock = vi.fn();
    const res = await callGrader("/grade", {}, { fetch: fetchMock as unknown as typeof fetch, env: { url: "", secret: "" } });
    expect(res).toMatchObject({ ok: false, kind: "not_configured", tries: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries once on a network error", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json(200, okBody));
    const res = await callGrader("/grade", {}, { fetch: fetchMock as unknown as typeof fetch, env, retryDelayMs: 0 });
    expect(res.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    if (res.ok) expect(res.tries).toBe(2);
  });

  it("retries once on a 5xx, then gives up", async () => {
    const fetchMock = vi.fn(async () => json(500, { error: "internal_error" }));
    const res = await callGrader("/grade", {}, { fetch: fetchMock as unknown as typeof fetch, env, retryDelayMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ ok: false, kind: "http", status: 500, tries: 2 });
    if (!res.ok) expect(res.error).not.toContain("s3cret");
  });

  it("does not retry a 4xx", async () => {
    const fetchMock = vi.fn(async () => json(422, { error: "reference_data.area_mm2 is missing" }));
    const res = await callGrader("/grade", {}, { fetch: fetchMock as unknown as typeof fetch, env, retryDelayMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: false, kind: "http", status: 422 });
    if (!res.ok) expect(res.error).toContain("area_mm2");
  });

  it("times out without retrying", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })
    );
    const res = await callGrader("/grade", {}, { fetch: fetchMock as unknown as typeof fetch, env, timeoutMs: 20, retryDelayMs: 0 });
    expect(res).toMatchObject({ ok: false, kind: "timeout", tries: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response that breaks the contract", async () => {
    const fetchMock = vi.fn(async () => json(200, { hello: "world" }));
    const res = await callGrader("/grade", {}, { fetch: fetchMock as unknown as typeof fetch, env, retryDelayMs: 0 });
    expect(res).toMatchObject({ ok: false, kind: "invalid_response" });
  });

  it("parses /grade-package results", async () => {
    const body = {
      submission_id: "a",
      results: [{ ...okBody, task_id: "t1", file_name: "Results/Parts and Assemblies/Part_03.step", matched_by: "name", matched_by_volume: false }],
      unmatched_files: [],
      ignored_files: ["x.ipt"],
      timing_ms: 10,
    };
    const fetchMock = vi.fn(async () => json(200, body));
    const res = await callGrader("/grade-package", {}, { fetch: fetchMock as unknown as typeof fetch, env, retryDelayMs: 0 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.results[0].task_id).toBe("t1");
  });
});
