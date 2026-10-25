import { beforeEach, describe, expect, it, vi } from "vitest";

// requireUser / requireAccount: the route-handler side of lib/auth/guards.ts.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/auth/get-session", () => ({ getAuthUser: vi.fn(), getSessionContext: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { isSuperAdminSession, requireAccount, requireUser } from "@/lib/auth/guards";

const client = { auth: { getUser: mocks.getUser } };
const member = { id: "u1", email: "a@example.com", is_anonymous: false };
const guest = { id: "u2", email: "", is_anonymous: true };

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.createClient.mockReset();
  mocks.createClient.mockResolvedValue(client);
});

describe("requireUser", () => {
  it("returns the user and the cookie-bound client", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: member } });
    const r = await requireUser();
    expect(r).toEqual({ ok: true, user: member, supabase: client });
  });

  it("answers 401 { error: 'sign_in' } when signed out", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const r = await requireUser();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
    expect(await r.response.json()).toEqual({ error: "sign_in" });
  });

  it("lets a guest session through by default", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: guest } });
    const r = await requireUser();
    expect(r.ok).toBe(true);
  });

  it("rejects a guest when allowAnonymous is false", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: guest } });
    const r = await requireUser({ allowAnonymous: false });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(401);
    expect(await r.response.json()).toEqual({ error: "sign_in" });
  });
});

describe("requireAccount", () => {
  it("accepts a real account and rejects a guest or no user with 401", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: member } });
    expect((await requireAccount()).ok).toBe(true);

    mocks.getUser.mockResolvedValue({ data: { user: guest } });
    const g = await requireAccount();
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.response.status).toBe(401);

    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const n = await requireAccount();
    expect(n.ok).toBe(false);
    if (!n.ok) expect(await n.response.json()).toEqual({ error: "sign_in" });
  });
});

describe("isSuperAdminSession", () => {
  const sessionOf = (role: string) => ({ email: "a@example.com", profile: { role }, tenant: null }) as never;

  it("is true only for the super_admin role", () => {
    expect(isSuperAdminSession(sessionOf("super_admin"))).toBe(true);
    expect(isSuperAdminSession(sessionOf("workshop"))).toBe(false);
    expect(isSuperAdminSession(sessionOf("client"))).toBe(false);
  });

  it("is false when there is no session", () => {
    expect(isSuperAdminSession(null)).toBe(false);
    expect(isSuperAdminSession(undefined)).toBe(false);
  });
});
