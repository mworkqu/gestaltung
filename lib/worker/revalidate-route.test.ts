// POST /api/internal/revalidate: auth, body validation, and that it purges
// exactly the accepted tags through revalidateTag.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", async (orig) => ({ ...(await orig<typeof import("next/cache")>()), revalidateTag }));

import { POST } from "@/app/api/internal/revalidate/route";

const SECRET = "w".repeat(40);
const req = (body: unknown, auth: string | null = `Bearer ${SECRET}`, type = "application/json") =>
  new Request("https://gestaltung360.com/api/internal/revalidate", {
    method: "POST",
    headers: { ...(auth ? { authorization: auth } : {}), "content-type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/internal/revalidate", () => {
  beforeEach(() => {
    vi.stubEnv("WORKER_SECRET", SECRET);
    revalidateTag.mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("purges the allowed tags and answers them", async () => {
    const r = await POST(req({ tags: ["parts-listing", "part-VLT-1", "part-VLT-1"] }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ purged: ["parts-listing", "part-VLT-1"] });
    expect(revalidateTag.mock.calls.map((c) => c[0])).toEqual(["parts-listing", "part-VLT-1"]);
  });

  it("401 without, with a wrong, or with an unset secret", async () => {
    expect((await POST(req({ tags: ["parts"] }, null))).status).toBe(401);
    expect((await POST(req({ tags: ["parts"] }, `Bearer ${SECRET}x`))).status).toBe(401);
    vi.stubEnv("WORKER_SECRET", "");
    expect((await POST(req({ tags: ["parts"] }, "Bearer "))).status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("400 for unknown tags or a bad body, 415 / 413 from the shared parser", async () => {
    const bad = await POST(req({ tags: ["layout"] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad_tags" });
    expect((await POST(req({ tags: [] }))).status).toBe(400);
    expect((await POST(req({ nope: 1 }))).status).toBe(400);
    expect((await POST(req("{"))).status).toBe(400);
    expect((await POST(req({ tags: ["parts"] }, `Bearer ${SECRET}`, "text/plain"))).status).toBe(415);
    expect((await POST(req({ tags: ["parts"], pad: "x".repeat(20_000) }))).status).toBe(413);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
