import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { createExportHandler, devOwnerEnabled, type ExportConfig, type ExportDeps } from "./export-route";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const req = (qs = "") => new Request(`https://example.test/api/admin/x/${ID}/export${qs}`);
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

function fakeUserClient(opts: { userId?: string | null; role?: string | null }) {
  const { userId = "u1", role = null } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role } : null }) }) }) }),
  } as unknown as SupabaseClient;
}

function setup(over: { userId?: string | null; role?: string | null; env?: ExportDeps["env"]; own?: boolean; data?: Record<string, unknown> | null } = {}) {
  const calls = { load: 0, isOwn: 0 };
  let seen: { exportedBy?: string; service?: unknown } = {};
  const service = {} as SupabaseClient;
  const config: ExportConfig = {
    load: async (_db, _id, o) => {
      calls.load++;
      seen = o;
      return over.data === undefined ? { thing: { name: "Robot Arm" }, _notes: [] as string[] } : over.data;
    },
    filename: (d, id) => `thing-${(d.thing as { name: string }).name}-${id.slice(0, 8)}.json`,
    devOwner: {
      isOwn: async () => {
        calls.isOwn++;
        return over.own ?? false;
      },
      exportedBy: "dev owner",
      note: "dev note",
    },
  };
  const handler = createExportHandler(config, {
    userClient: async () => fakeUserClient(over),
    serviceClient: () => service,
    env: over.env ?? { NODE_ENV: "development" },
  });
  return { handler, calls, service, seen: () => seen };
}

describe("devOwnerEnabled", () => {
  it("is on only outside production AND with EXPORT_DEV_OWNER=1", () => {
    expect(devOwnerEnabled({ NODE_ENV: "development", EXPORT_DEV_OWNER: "1" })).toBe(true);
    expect(devOwnerEnabled({ NODE_ENV: "test", EXPORT_DEV_OWNER: "1" })).toBe(true);
    expect(devOwnerEnabled({ NODE_ENV: "production", EXPORT_DEV_OWNER: "1" })).toBe(false);
    expect(devOwnerEnabled({ NODE_ENV: "development" })).toBe(false);
    expect(devOwnerEnabled({ NODE_ENV: "development", EXPORT_DEV_OWNER: "true" })).toBe(false);
  });
});

describe("export gate", () => {
  it("400 for a malformed id, before touching the session", async () => {
    const t = setup();
    expect((await t.handler(req(), ctx("../etc"))).status).toBe(400);
    expect(t.calls.load).toBe(0);
  });

  it("401 with no session", async () => {
    expect((await setup({ userId: null }).handler(req(), ctx())).status).toBe(401);
  });

  it("403 for a non-admin when the hook is off (default), and the record is never loaded", async () => {
    const t = setup({ role: "client", own: true });
    expect((await t.handler(req(), ctx())).status).toBe(403);
    expect(t.calls).toEqual({ load: 0, isOwn: 0 });
  });

  it("403 in production even with EXPORT_DEV_OWNER=1", async () => {
    const t = setup({ role: "client", own: true, env: { NODE_ENV: "production", EXPORT_DEV_OWNER: "1" } });
    expect((await t.handler(req(), ctx())).status).toBe(403);
    expect(t.calls).toEqual({ load: 0, isOwn: 0 });
  });

  it("hook on: 403 for someone else's record, 200 for their own with the dev note appended", async () => {
    const env = { NODE_ENV: "development", EXPORT_DEV_OWNER: "1" };
    const no = setup({ role: "client", own: false, env });
    expect((await no.handler(req(), ctx(OTHER))).status).toBe(403);
    expect(no.calls).toEqual({ load: 0, isOwn: 1 });

    const yes = setup({ role: "client", own: true, env });
    const res = await yes.handler(req(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json())._notes).toEqual(["dev note"]);
    expect(yes.seen().exportedBy).toBe("dev owner");
  });

  it("super_admin passes without the hook or an ownership check, with no note", async () => {
    const t = setup({ role: "super_admin" });
    const res = await t.handler(req(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json())._notes).toEqual([]);
    expect(t.calls.isOwn).toBe(0);
    expect(t.seen()).toEqual({ exportedBy: "super_admin", service: t.service });
  });

  it("404 when the loader finds no record", async () => {
    expect((await setup({ role: "super_admin", data: null }).handler(req(), ctx())).status).toBe(404);
  });
});

describe("export response", () => {
  it("JSON, no-store, no attachment by default", async () => {
    const res = await setup({ role: "super_admin" }).handler(req(), ctx());
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("?download=1 adds the attachment name; other values do not", async () => {
    const t = setup({ role: "super_admin" });
    const res = await t.handler(req("?download=1"), ctx());
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="thing-Robot Arm-11111111.json"');
    expect((await t.handler(req("?download=0"), ctx())).headers.get("content-disposition")).toBeNull();
  });

  it("pretty-prints the body", async () => {
    const res = await setup({ role: "super_admin" }).handler(req(), ctx());
    expect(await res.text()).toBe(JSON.stringify({ thing: { name: "Robot Arm" }, _notes: [] }, null, 2));
  });
});
