// POST /api/worker-token: session required (guests allowed), project ownership
// checked server-side, token verifiable with WORKER_SECRET, rate limited, 503
// while the secret is unset. Supabase is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyWorkerToken } from "./token";

const m = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth/guards", () => ({ requireUser: m.requireUser }));

import { POST } from "@/app/api/worker-token/route";

const SECRET = "t".repeat(40);
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MY_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const THEIR_PROJECT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function stubSupabase(role: string) {
  const projects: Record<string, { id: string; user_id: string }> = {
    [MY_PROJECT]: { id: MY_PROJECT, user_id: ME },
    [THEIR_PROJECT]: { id: THEIR_PROJECT, user_id: OTHER },
  };
  return {
    from(table: string) {
      let id = "";
      const q = {
        select: () => q,
        eq: (_c: string, v: string) => {
          id = v;
          return q;
        },
        maybeSingle: async () => ({ data: table === "profiles" ? { role } : (projects[id] ?? null), error: null }),
      };
      return q;
    },
    rpc: async () => ({ data: { tier: "maker", balance: 99 }, error: null }),
  };
}

function signIn(role = "client", anonymous = true) {
  m.requireUser.mockResolvedValue({ ok: true, user: { id: ME, is_anonymous: anonymous }, supabase: stubSupabase(role) });
}

const post = (body: unknown = {}) =>
  POST(new Request("https://gestaltung360.com/api/worker-token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.stubEnv("WORKER_SECRET", SECRET);
  m.requireUser.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/worker-token", () => {
  it("503 while WORKER_SECRET is unset or short", async () => {
    vi.stubEnv("WORKER_SECRET", "short");
    const r = await post();
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "worker_unavailable" });
    expect(m.requireUser).not.toHaveBeenCalled();
  });

  it("401 sign_in without a session", async () => {
    m.requireUser.mockResolvedValue({ ok: false, response: Response.json({ error: "sign_in" }, { status: 401 }) });
    expect((await post()).status).toBe(401);
  });

  it("mints a 10-minute token for a guest's own project, without credits", async () => {
    signIn("client", true);
    const r = await post({ projectId: MY_PROJECT });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const j = (await r.json()) as { token: string; expiresAt: string; projectId: string; tier: string; isAdmin: boolean };
    expect(j).toMatchObject({ projectId: MY_PROJECT, tier: "maker", isAdmin: false });
    const v = verifyWorkerToken(j.token, SECRET);
    expect(v.ok && v.claims).toMatchObject({ sub: ME, pid: MY_PROJECT, tier: "maker", adm: false, anon: true });
    expect(v.ok && v.claims.exp - v.claims.iat).toBe(600);
    expect(JSON.stringify(v.ok && v.claims)).not.toContain("99");
  });

  it("404 for someone else's project, unless super_admin", async () => {
    signIn("client");
    expect((await post({ projectId: THEIR_PROJECT })).status).toBe(404);
    expect((await post({ projectId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })).status).toBe(404);
    signIn("super_admin", false);
    const r = await post({ projectId: THEIR_PROJECT });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { isAdmin: boolean }).isAdmin).toBe(true);
  });

  it("no project = token without a project; bad bodies are 400", async () => {
    signIn();
    const r = await post({});
    expect(((await r.json()) as { projectId: unknown }).projectId).toBeNull();
    expect((await post({ projectId: "nope" })).status).toBe(400);
    expect((await post({ projectId: MY_PROJECT, credits: 100 })).status).toBe(400);
  });

  it("rate limits a user to 20 a minute", async () => {
    signIn();
    m.requireUser.mockResolvedValue({ ok: true, user: { id: "rate-user", is_anonymous: true }, supabase: stubSupabase("client") });
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await post()).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(20);
    expect(codes.slice(-2)).toEqual([429, 429]);
  });
});
