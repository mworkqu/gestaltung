// DB-01 G1.2: the engineering job snapshot (owner-readable, 0091) never stores
// the private product models; the admin download adds them at read time with
// the service role. Mocked Supabase, no network.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fakeSupabase } from "@/lib/studio/server/fake-supabase";

type Fake = ReturnType<typeof fakeSupabase>;
const state: { main: Fake; service: Fake | null; role: string } = { main: fakeSupabase({}), service: null, role: "super_admin" };

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.main.client }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => state.service?.client ?? null }));
vi.mock("@/lib/auth/get-session", () => ({ getAuthUser: async () => null, getSessionContext: async () => ({ profile: { role: state.role } }) }));

const { submitStepJob } = await import("./server");
const { GET: snapshot } = await import("@/app/[locale]/dashboard/engineering-jobs/[id]/snapshot/route");

const P = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const USER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
const PRIV = { designs: [{ id: "d_aaaaaaaaaa", model: { bodies: [{ id: "b" }] }, source: "ai" }] };

beforeEach(() => {
  // Pre-0100 shape on purpose: studio still carries productPrivate.
  const tables = {
    projects: [{ id: P, user_id: USER.id, name: "Lamp", studio: { spec: { name: "Lamp" }, product: { designs: [] }, productPrivate: PRIV } }],
    project_studio_private: [{ project_id: P, product_private: PRIV }],
    engineering_jobs: [] as Record<string, unknown>[],
  };
  state.main = fakeSupabase({ tables, user: USER });
  state.service = fakeSupabase({
    tables,
    bypassRls: true,
    rpc: {
      engineering_job_submit: (a) => {
        tables.engineering_jobs.push({ id: JOB, project_id: a.p_project, user_id: a.p_user, snapshot: a.p_snapshot });
        return { data: { id: JOB } };
      },
    },
  });
  state.role = "super_admin";
});

describe("engineering job snapshot (DB-01 G1.2)", () => {
  it("the stored, owner-readable snapshot has no productPrivate", async () => {
    const r = await submitStepJob(state.main.client as never, { id: USER.id, isAdmin: false }, P, "");
    expect(r.ok).toBe(true);
    const snap = state.main.db.tables.engineering_jobs[0].snapshot as { studio: Record<string, unknown> };
    expect(snap.studio.product).toEqual({ designs: [] });
    expect(snap.studio).not.toHaveProperty("productPrivate");
    expect(JSON.stringify(snap)).not.toContain('"bodies"');
  });

  it("the admin download adds the private models at read time; others get 403", async () => {
    await submitStepJob(state.main.client as never, { id: USER.id, isAdmin: false }, P, "");
    const res = await snapshot(new Request("http://x"), { params: Promise.resolve({ id: JOB }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { studio: { productPrivate: { designs: { id: string; model: unknown }[] } } };
    expect(body.studio.productPrivate.designs.map((d) => d.id)).toEqual(["d_aaaaaaaaaa"]);
    expect(body.studio.productPrivate.designs[0].model).toBeTruthy();
    state.role = "client";
    expect((await snapshot(new Request("http://x"), { params: Promise.resolve({ id: JOB }) })).status).toBe(403);
  });
});
