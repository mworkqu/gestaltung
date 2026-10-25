import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake request-scoped Supabase client: auth.getUser() and
// from(table).select().eq().single() resolve to fixtures keyed by table.
type Row = Record<string, unknown> | null;
const state = vi.hoisted(() => ({
  user: null as { id: string; email?: string | null; is_anonymous?: boolean } | null,
  tables: {} as Record<string, Row>,
  getUser: 0,
  queries: [] as { table: string; eq: [string, unknown] }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        state.getUser++;
        return { data: { user: state.user } };
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          state.queries.push({ table, eq: [col, val] });
          const result = async () => ({ data: state.tables[table] ?? null });
          return { single: result, maybeSingle: result };
        },
      }),
    }),
  }),
}));

import { getAuthUser, getSessionContext } from "./get-session";

const TENANT = { id: "t1", type: "school", name: "Doha Academy", created_at: "2026-01-01" };
const profile = (over: Record<string, unknown> = {}) => ({
  id: "u1",
  role: "client",
  tenant_id: null,
  full_name: "Mona",
  phone: null,
  locale: "en",
  created_at: "2026-01-01",
  ...over,
});

beforeEach(() => {
  state.user = null;
  state.tables = {};
  state.getUser = 0;
  state.queries = [];
});

describe("getAuthUser", () => {
  it("is null when signed out", async () => {
    expect(await getAuthUser()).toBeNull();
  });

  it("returns the user, an anonymous guest included", async () => {
    state.user = { id: "g1", email: null, is_anonymous: true };
    expect(await getAuthUser()).toMatchObject({ id: "g1", is_anonymous: true });
  });
});

describe("getSessionContext", () => {
  it("is null with no user, without reading any table", async () => {
    expect(await getSessionContext()).toBeNull();
    expect(state.queries).toEqual([]);
  });

  it("is null when the user has no profile yet", async () => {
    state.user = { id: "u1", email: "a@b.co" };
    expect(await getSessionContext()).toBeNull();
  });

  it("client: email + profile, tenant null when tenant_id is null (no tenants query)", async () => {
    state.user = { id: "u1", email: "mona@example.com" };
    state.tables.profiles = profile();
    const ctx = await getSessionContext();
    expect(ctx).toEqual({ email: "mona@example.com", profile: profile(), tenant: null });
    expect(state.queries).toEqual([{ table: "profiles", eq: ["id", "u1"] }]);
  });

  it("loads the tenant row when the profile has a tenant_id", async () => {
    state.user = { id: "u1", email: "w@example.com" };
    state.tables.profiles = profile({ role: "workshop", tenant_id: "t1" });
    state.tables.tenants = TENANT;
    const ctx = await getSessionContext();
    expect(ctx?.profile.role).toBe("workshop");
    expect(ctx?.tenant).toEqual(TENANT);
    expect(state.queries.at(-1)).toEqual({ table: "tenants", eq: ["id", "t1"] });
  });

  it("tenant is null when the tenants row is hidden by RLS", async () => {
    state.user = { id: "u1", email: "w@example.com" };
    state.tables.profiles = profile({ role: "workshop", tenant_id: "t1" });
    expect((await getSessionContext())?.tenant).toBeNull();
  });

  it("super_admin: role passes through unchanged", async () => {
    state.user = { id: "a1", email: "owner@example.com" };
    state.tables.profiles = profile({ id: "a1", role: "super_admin" });
    const ctx = await getSessionContext();
    expect(ctx?.profile.role).toBe("super_admin");
    expect(ctx?.tenant).toBeNull();
  });

  it("anonymous guest with a profile: email is the empty string", async () => {
    state.user = { id: "g1", email: undefined, is_anonymous: true };
    state.tables.profiles = profile({ id: "g1", full_name: null });
    const ctx = await getSessionContext();
    expect(ctx?.email).toBe("");
    expect(ctx?.profile.id).toBe("g1");
  });

  it("knownUser skips the auth round trip", async () => {
    state.tables.profiles = profile();
    const ctx = await getSessionContext({ id: "u1", email: "mona@example.com" });
    expect(ctx?.email).toBe("mona@example.com");
    expect(state.getUser).toBe(0);
  });

  it("knownUser = null means signed out (no auth call, no queries)", async () => {
    state.user = { id: "u1", email: "ignored@example.com" };
    expect(await getSessionContext(null)).toBeNull();
    expect(state.getUser).toBe(0);
    expect(state.queries).toEqual([]);
  });
});
