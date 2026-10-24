// AI-05: the wiring routes (/api/netlist, /api/bom/electronics,
// /api/studio/wiring) never hand out a circuit they could not charge for.
//   * no service key (spend_credit_for cannot run) and not admin → 503
//     "unavailable" BEFORE the build / model call;
//   * spend refused after the build → the refusal (402 no_credits, 503
//     unavailable, …), no circuit in the body, and nothing of the build kept.
// Mocked Supabase (lib/studio/server/fake-supabase.ts), mocked builders; no AI.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_LIBRARY } from "@/lib/studio/library";
import { GOLDEN_IDEAS, goldenParts } from "@/lib/studio/product/__fixtures__/golden";
import { fakeSupabase } from "@/lib/studio/server/fake-supabase";

type Fake = ReturnType<typeof fakeSupabase>;
type Row = Record<string, unknown>;
const state: { main: Fake; service: Fake | null } = { main: fakeSupabase({}), service: null };

const mocks = vi.hoisted(() => ({
  buildElectronics: vi.fn(),
  buildWiring: vi.fn(),
  updateDoc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.main.client }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => state.service?.client ?? null }));
vi.mock("@/lib/prototyping/electronics-build", () => ({ buildElectronics: mocks.buildElectronics }));
vi.mock("@/lib/studio/library/remote", () => ({ studioLibrary: async () => CODE_LIBRARY }));
vi.mock("@/lib/schools/safe-parts", () => ({
  classGuard: async (_s: unknown, _p: unknown, lib: unknown) => ({ isClass: false, lib }),
  classDocRefusal: () => null,
}));
vi.mock("@/lib/studio/netlist", () => ({ buildWiring: mocks.buildWiring }));
vi.mock("@/lib/studio/server/doc", () => ({
  loadDoc: async () => ({ ok: true, doc: null, version: 1 }),
  updateDoc: mocks.updateDoc,
}));

const { POST: netlist } = await import("@/app/api/netlist/route");
const { POST: electronics } = await import("@/app/api/bom/electronics/route");
const { POST: wiring } = await import("@/app/api/studio/wiring/route");

const P = "11111111-1111-4111-8111-111111111111";
const USER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", is_anonymous: false };
const OLD_BOM = { lines: [{ id: "old" }] };
const OLD_NETLIST = { nets: ["old"] };
const NEW_NETLIST = { nets: ["new"] };

type Spend = "ok" | "no_credits" | "boom";

function setup(o: { role?: "user" | "admin"; service?: boolean; spend?: Spend } = {}) {
  const role = o.role ?? "user";
  const tables = {
    projects: [
      {
        id: P,
        user_id: USER.id,
        brief: "a plant waterer",
        spec: null,
        bom: structuredClone(OLD_BOM),
        netlist: structuredClone(OLD_NETLIST),
        build_route: "prototype",
        studio: null,
        studio_version: 1,
      },
    ] as Row[],
    profiles: [{ id: USER.id, role: role === "admin" ? "super_admin" : "client" }],
  };
  state.main = fakeSupabase({
    tables,
    user: USER,
    rpc: {
      credit_can_use: () => ({ data: { allowed: true, reason: null, cost: role === "admin" ? "none" : "credit", role, balance: 3 } }),
    },
  });
  const spend = o.spend ?? "ok";
  state.service =
    o.service === false
      ? null
      : fakeSupabase({
          tables,
          user: null,
          bypassRls: true,
          rpc: {
            spend_credit_for: () =>
              spend === "ok"
                ? { data: { charged: role !== "admin", cost: role === "admin" ? "none" : "credit", balance: 2 } }
                : { error: { code: "P0001", message: spend === "no_credits" ? "no_credits" : "connection reset" } },
          },
        });
}

const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const projectRow = () => state.main.db.tables.projects[0] as Row;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.buildElectronics.mockReset();
  // Like the real buildElectronics: saves bom + netlist on the caller's session, then answers.
  mocks.buildElectronics.mockImplementation(async ({ supabase, project }: { supabase: Fake["client"]; project: { id: string } }) => {
    const bom = { lines: [{ id: "new" }] };
    await supabase.from("projects").update({ bom, netlist: NEW_NETLIST }).eq("id", project.id);
    return { ok: true, bom, netlist: NEW_NETLIST, circuit: "ok", problems: [] };
  });
  mocks.buildWiring.mockReset();
  mocks.buildWiring.mockReturnValue({ components: [], netlist: { nets: [{ id: "n" }] }, checks: [{ id: "c" }], legacy: false });
  mocks.updateDoc.mockReset();
  mocks.updateDoc.mockResolvedValue({ saved: true, version: 2 });
  setup();
});

describe("POST /api/netlist (AI-05)", () => {
  it("charges and returns the circuit when the spend succeeds", async () => {
    const r = await netlist(post({ projectId: P }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ netlist: NEW_NETLIST, charged: true, cost: "credit" });
    expect(projectRow().netlist).toEqual(NEW_NETLIST);
  });

  it("no service key → 503 unavailable before the model call", async () => {
    setup({ service: false });
    const r = await netlist(post({ projectId: P }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "unavailable" });
    expect(mocks.buildElectronics).not.toHaveBeenCalled();
  });

  it("admin without a service key still draws (never charged)", async () => {
    setup({ role: "admin", service: false });
    const r = await netlist(post({ projectId: P }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ netlist: NEW_NETLIST, charged: false });
  });

  it("spend refused (no_credits) → 402, no circuit, bom + netlist put back", async () => {
    setup({ spend: "no_credits" });
    const r = await netlist(post({ projectId: P }));
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "no_credits" });
    expect(projectRow()).toMatchObject({ bom: OLD_BOM, netlist: OLD_NETLIST });
  });

  it("spend failed (database error) → 503 unavailable, rolled back", async () => {
    setup({ spend: "boom" });
    const r = await netlist(post({ projectId: P }));
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: "unavailable" });
    expect(projectRow()).toMatchObject({ bom: OLD_BOM, netlist: OLD_NETLIST });
  });
});

describe("POST /api/bom/electronics (AI-05)", () => {
  it("charges a drawn circuit", async () => {
    const r = await electronics(post({ projectId: P }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ circuit: "ok", charged: true });
  });

  it("no service key → 503 before the model calls; the free list-only run still works", async () => {
    setup({ service: false });
    const r = await electronics(post({ projectId: P }));
    expect(r.status).toBe(503);
    expect(mocks.buildElectronics).not.toHaveBeenCalled();
    mocks.buildElectronics.mockResolvedValueOnce({ ok: true, bom: OLD_BOM, netlist: null, circuit: "skipped", problems: [] });
    const l = await electronics(post({ projectId: P, listOnly: true }));
    expect(l.status).toBe(200);
    expect(await l.json()).toMatchObject({ circuit: "skipped", circuitReason: "list_only", charged: false });
  });

  it("spend refused → 402 no_credits and nothing of the build is kept", async () => {
    setup({ spend: "no_credits" });
    const r = await electronics(post({ projectId: P }));
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "no_credits" });
    expect(projectRow()).toMatchObject({ bom: OLD_BOM, netlist: OLD_NETLIST });
  });
});

describe("POST /api/studio/wiring (AI-05)", () => {
  const g = GOLDEN_IDEAS[0];
  const body = () => ({
    projectId: P,
    spec: g.spec,
    components: goldenParts(g).map((p) => ({ partId: p.part.id, instanceId: p.instanceId, label: p.part.name.en })),
  });

  it("charges, then saves the doc", async () => {
    const r = await wiring(post(body()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ charged: true, docVersion: 2 });
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
  });

  it("no service key → 503 before the build", async () => {
    setup({ service: false });
    const r = await wiring(post(body()));
    expect(r.status).toBe(503);
    expect(mocks.buildWiring).not.toHaveBeenCalled();
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it("spend refused → 402, no circuit, the doc is not saved", async () => {
    setup({ spend: "no_credits" });
    const r = await wiring(post(body()));
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "no_credits" });
    expect(mocks.updateDoc).not.toHaveBeenCalled();
  });

  it("admin: free, saved, even without a service key", async () => {
    setup({ role: "admin", service: false });
    const r = await wiring(post(body()));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ charged: false });
    expect(mocks.updateDoc).toHaveBeenCalledTimes(1);
  });
});
