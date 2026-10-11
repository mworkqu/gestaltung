// P5-16 product API: owner checks, guest limit, credits, the model gate, and the
// doc save that can't erase or forge server-owned data. Mocked Supabase + Gemini.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { CODE_LIBRARY } from "@/lib/studio/library";
import { emptyStudioDoc, type StudioDoc } from "@/lib/studio/schema";
import { GOLDEN_IDEAS, goldenParts } from "@/lib/studio/product/__fixtures__/golden";
import { archetypeDefault } from "@/lib/studio/product/archetypes";
import { fakeSupabase, type FakeDb } from "./fake-supabase";

type Fake = ReturnType<typeof fakeSupabase>;
const state: { main: Fake; service: Fake | null; gemini: boolean; answers: unknown[] } = {
  main: fakeSupabase({}),
  service: null,
  gemini: false,
  answers: [],
};

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.main.client }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => state.service?.client ?? null }));
vi.mock("@/lib/studio/library/remote", () => ({ studioLibrary: async () => CODE_LIBRARY }));
vi.mock("@/lib/prototyping/providers/gemini-client", () => ({
  geminiConfigured: () => state.gemini,
  callGemini: async () => {
    const next = state.answers.shift();
    return { raw: next, rawText: JSON.stringify(next ?? null), model: "fake", latencyMs: 1 };
  },
}));

const { POST: design } = await import("@/app/api/studio/product/design/route");
const { POST: check } = await import("@/app/api/studio/product/check/route");
const { POST: preview } = await import("@/app/api/studio/product/preview/route");
const { POST: choose } = await import("@/app/api/studio/product/choose/route");
const { POST: unlock } = await import("@/app/api/studio/product/unlock/route");
const { GET: getModel } = await import("@/app/api/studio/product/model/route");
const { GET: engineer } = await import("@/app/api/studio/product/engineer/route");
const { GET: docGet, PUT: docPut } = await import("@/app/api/studio/doc/route");

const P = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const GUEST = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", is_anonymous: true };
const USER = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", is_anonymous: false };
const ADMIN = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", is_anonymous: false };
const consent = { aiConsent: { at: "2026-10-11T00:00:00.000Z", destination: "Google Gemini" } };

const g = GOLDEN_IDEAS[0];
const parts = goldenParts(g);
function studioDoc(): StudioDoc {
  return {
    ...emptyStudioDoc(g.spec),
    components: parts.map((p) => ({ partId: p.part.id, instanceId: p.instanceId, label: p.part.name.en })),
  };
}

function setup(user: FakeDb["user"], opts: { owner?: string; consent?: boolean; credits?: "ok" | "none" | "sign_in" | "admin" } = {}) {
  const tables = {
    projects: [
      { id: P, user_id: opts.owner ?? user?.id, spec: opts.consent === false ? null : consent, brief: g.idea, studio: studioDoc(), studio_version: 1 },
      { id: OTHER, user_id: "someone-else", spec: consent, brief: "x", studio: studioDoc(), studio_version: 1 },
    ],
    profiles: [{ id: ADMIN.id, role: "super_admin" }, { id: USER.id, role: "client" }],
    ai_rate_limits: [] as Record<string, unknown>[],
    analysis_runs: [] as Record<string, unknown>[],
    cad_generations: [] as Record<string, unknown>[],
  };
  const credit = opts.credits ?? "ok";
  state.main = fakeSupabase({
    tables,
    user,
    rpc: {
      credit_can_use: () =>
        credit === "sign_in"
          ? { data: { allowed: false, reason: "sign_in", cost: null, role: "anonymous" } }
          : credit === "none"
            ? { data: { allowed: false, reason: "no_credits", cost: null, role: "user" } }
            : { data: { allowed: true, reason: null, cost: credit === "admin" ? "none" : "credit", role: credit === "admin" ? "admin" : "user" } },
      cad_begin: () => ({ data: "gen-1" }),
      cad_set_code: () => ({ data: null }),
      cad_deliver: () => ({ data: { charged: credit !== "admin", regens: 2 } }),
      cad_fail: () => ({ data: null }),
    },
  });
  state.service = fakeSupabase({ tables, user: null });
  state.gemini = false;
  state.answers = [];
}

const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
const get = (qs: string) => new Request(`http://x/api?${qs}`);
const studioOf = (id = P) => state.main.db.tables.projects.find((r) => r.id === id)!.studio as Record<string, unknown> & StudioDoc;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]).toString("base64");
const images = { front: PNG, side: PNG, iso: PNG };

async function designOne(): Promise<string> {
  const r = await design(post({ projectId: P, count: 1 }));
  expect(r.status).toBe(200);
  return ((await r.json()) as { designs: { id: string }[] }).designs[0].id;
}

beforeEach(() => setup(USER));

describe("POST /design", () => {
  it("needs a session, the owner's project and AI consent", async () => {
    setup(null);
    expect((await design(post({ projectId: P }))).status).toBe(401);
    setup(USER);
    expect((await design(post({ projectId: OTHER }))).status).toBe(404);
    setup(USER, { consent: false });
    expect((await design(post({ projectId: P }))).status).toBe(403);
    setup(USER);
    expect((await design(post({ projectId: "nope" }))).status).toBe(400);
  });

  it("returns models to the worker, stores metadata page-safe and models private, no-store", async () => {
    const r = await design(post({ projectId: P, count: 3 }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/no-store/);
    const body = (await r.json()) as { designs: { id: string; archetype: string; model: { bodies: unknown[] }; why: { en: string; ar: string } }[] };
    expect(body.designs).toHaveLength(3);
    expect(new Set(body.designs.map((d) => d.archetype)).size).toBe(3);
    const stored = studioOf();
    expect(stored.product!.designs.map((d) => d.id)).toEqual(body.designs.map((d) => d.id));
    expect((stored.productPrivate as { designs: { id: string }[] }).designs).toHaveLength(3);
    // The page never sees the models.
    const page = (await (await docGet(get(`projectId=${P}`))).json()) as { doc: Record<string, unknown> };
    expect(page.doc.productPrivate).toBeUndefined();
    expect(JSON.stringify(page.doc)).not.toContain('"bodies"');
    expect((page.doc.product as { designs: unknown[] }).designs).toHaveLength(3);
  });

  it("uses the AI answer when Gemini is configured (metered as studio/product)", async () => {
    state.gemini = true;
    const a = "stake_device";
    const model = archetypeDefault(a, g.spec, parts);
    model.bodies[0].colour = "coral";
    state.answers = [{ designs: [{ archetype: a, thinking: {}, why_en: "Stands in the soil and waters at the roots.", why_ar: "يقف في التربة ويسقي عند الجذور.", model }] }];
    const r = await design(post({ projectId: P, count: 1 }));
    const d = ((await r.json()) as { designs: { why: { en: string }; model: { bodies: { colour: string }[] } }[] }).designs[0];
    expect(d.why.en).toBe("Stands in the soil and waters at the roots.");
    expect(d.model.bodies[0].colour).toBe("coral");
    expect(state.main.db.tables.analysis_runs.length).toBeGreaterThan(0);
  });

  it("guests: 3 design builds per day per session and per IP, then 429 guest_limit", async () => {
    setup(GUEST);
    for (let i = 0; i < 3; i++) expect((await design(post({ projectId: P, count: 1 }))).status).toBe(200);
    const r = await design(post({ projectId: P, count: 1 }));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "guest_limit" });
    // Same IP, another guest session: still limited (IP key, hashed).
    const tables = state.main.db.tables;
    expect(tables.ai_rate_limits.some((x) => String(x.key).startsWith("studio:ip:") && !String(x.key).includes("1.2.3.4"))).toBe(true);
    state.main.db.user = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", is_anonymous: true };
    tables.projects[0].user_id = state.main.db.user.id;
    expect((await design(post({ projectId: P, count: 1 }))).status).toBe(429);
    // A different IP and a new guest: allowed.
    state.main.db.user = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", is_anonymous: true };
    tables.projects[0].user_id = state.main.db.user.id;
    expect((await design(post({ projectId: P, count: 1 }, "9.9.9.9"))).status).toBe(200);
  });

  it("signed-in users are not guest-limited", async () => {
    for (let i = 0; i < 4; i++) expect((await design(post({ projectId: P, count: 1 }))).status).toBe(200);
  });
});

describe("POST /check", () => {
  it("no key → skipped no_key with the model; bad images → 400; unknown design → 404", async () => {
    const id = await designOne();
    expect((await check(post({ projectId: P, designId: id, images: { ...images, iso: "AAAA".repeat(10) }, loop: 0 }))).status).toBe(400);
    expect((await check(post({ projectId: P, designId: "d_zzzzzzzzzz", images, loop: 0 }))).status).toBe(404);
    const r = (await (await check(post({ projectId: P, designId: id, images, loop: 0 }))).json()) as { skipped: string; model: unknown };
    expect(r.skipped).toBe("no_key");
    expect(r.model).toBeTruthy();
  });

  it("applies allowed patches, stores score/loops privately, keeps the best version", async () => {
    const id = await designOne();
    state.gemini = true;
    state.answers = [{ score: 5, looksLike: "a puck", missing: ["outlet"], patches: [{ op: "replace", path: "/bodies/0/colour", valueJson: '"coral"' }, { op: "replace", path: "/bodies/0/id", valueJson: '"x"' }] }];
    const r = (await (await check(post({ projectId: P, designId: id, images, loop: 0 }))).json()) as { score: number; changed: boolean; model: { bodies: { colour: string; id: string }[] } };
    expect(r.score).toBe(5);
    expect(r.changed).toBe(true);
    expect(r.model.bodies[0].colour).toBe("coral");
    const priv = (studioOf().productPrivate as { designs: { id: string; score: number; loops: number; best: { score: number } }[] }).designs.find((d) => d.id === id)!;
    expect(priv).toMatchObject({ score: 5, loops: 1, best: { score: 5 } });
    // quota / outage → skipped quota, model kept
    state.answers = [];
    const s = (await (await check(post({ projectId: P, designId: id, images, loop: 1 }))).json()) as { skipped?: string };
    expect(s.skipped).toBe("quota");
  });
});

describe("POST /preview + /choose", () => {
  it("stores the picture under studio-previews/<project>/<design>.png in project-images", async () => {
    const id = await designOne();
    expect((await preview(post({ projectId: P, designId: id, png: "bm90IGEgcG5n" }))).status).toBe(400);
    const r = await preview(post({ projectId: P, designId: id, png: PNG }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ previewPath: `studio-previews/${P}/${id}.png` });
    expect(state.service!.db.uploads).toEqual([{ bucket: "project-images", path: `studio-previews/${P}/${id}.png`, bytes: 72 }]);
    expect(studioOf().product!.designs[0]).toMatchObject({ status: "ready", previewPath: `studio-previews/${P}/${id}.png` });
  });

  it("no service key → 503 storage_unavailable; other users' projects → 404", async () => {
    const id = await designOne();
    state.service = null;
    expect((await preview(post({ projectId: P, designId: id, png: PNG }))).status).toBe(503);
    expect((await preview(post({ projectId: OTHER, designId: id, png: PNG }))).status).toBe(404);
  });

  it("choose marks the design; unknown → 404", async () => {
    const id = await designOne();
    expect(await (await choose(post({ projectId: P, designId: id }))).json()).toEqual({ chosenId: id });
    expect(studioOf().product!.chosenId).toBe(id);
    expect((await choose(post({ projectId: P, designId: "d_zzzzzzzzzz" }))).status).toBe(404);
  });
});

describe("POST /unlock + GET /model", () => {
  it("model is locked before payment; unlock spends via cad_begin/cad_set_code/cad_deliver; then the model opens", async () => {
    const id = await designOne();
    expect((await getModel(get(`projectId=${P}&designId=${id}`))).status).toBe(403);
    const r = await unlock(post({ projectId: P, designId: id }));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { unlockedId: string; model: { bodies: unknown[] }; charged: boolean };
    expect(body.unlockedId).toBe(id);
    expect(body.charged).toBe(true);
    expect(state.main.db.rpcCalls.map((c) => c.fn)).toEqual(["credit_can_use", "cad_begin", "cad_set_code", "cad_deliver"]);
    expect(String(state.main.db.rpcCalls[1].args.p_request)).toMatch(/^studio product:/);
    expect(studioOf().product!.unlockedId).toBe(id);
    const m = await getModel(get(`projectId=${P}&designId=${id}`));
    expect(m.status).toBe(200);
    expect(((await m.json()) as { model: { bodies: unknown[] } }).model.bodies.length).toBeGreaterThan(1);
    // Unlocking it again never charges again.
    state.main.db.rpcCalls = [];
    expect((await unlock(post({ projectId: P, designId: id }))).status).toBe(200);
    expect(state.main.db.rpcCalls).toEqual([]);
  });

  it("guests → 403 sign_in; no credits → 402; nothing delivered", async () => {
    setup(GUEST, { credits: "sign_in" });
    let id = await designOne();
    let r = await unlock(post({ projectId: P, designId: id }));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ error: "sign_in" });
    setup(USER, { credits: "none" });
    id = await designOne();
    r = await unlock(post({ projectId: P, designId: id }));
    expect(r.status).toBe(402);
    expect(await r.json()).toEqual({ error: "no_credits" });
    expect(state.main.db.rpcCalls.some((c) => c.fn === "cad_deliver")).toBe(false);
    expect(studioOf().product!.unlockedId).toBeNull();
  });

  it("a page doc save cannot unlock, forge or erase", async () => {
    const id = await designOne();
    const page = (await (await docGet(get(`projectId=${P}`))).json()) as { doc: StudioDoc; version: number };
    const forged = { ...page.doc, product: { ...page.doc.product!, unlockedId: id }, productPrivate: { designs: [] } };
    const r = await docPut(new Request("http://x/api", { method: "PUT", body: JSON.stringify({ projectId: P, doc: forged, version: page.version }) }));
    expect(r.status).toBe(200);
    expect(studioOf().product!.unlockedId).toBeNull();
    expect((studioOf().productPrivate as { designs: unknown[] }).designs).toHaveLength(1);
    expect((await getModel(get(`projectId=${P}&designId=${id}`))).status).toBe(403);
    // A stale version is still a conflict (and the answer is page-safe).
    const stale = await docPut(new Request("http://x/api", { method: "PUT", body: JSON.stringify({ projectId: P, doc: page.doc, version: page.version }) }));
    expect(stale.status).toBe(409);
    expect(JSON.stringify(await stale.json())).not.toContain("productPrivate");
  });

  it("super_admin may read any model and the engineer data; others may not", async () => {
    const id = await designOne();
    expect((await engineer(get(`projectId=${P}`))).status).toBe(403);
    state.main.db.user = ADMIN;
    expect((await getModel(get(`projectId=${P}&designId=${id}`))).status).toBe(200);
    const e = (await (await engineer(get(`projectId=${P}`))).json()) as { productPrivate: { designs: { id: string; issues: unknown[] }[] } };
    expect(e.productPrivate.designs[0].id).toBe(id);
    expect(Array.isArray(e.productPrivate.designs[0].issues)).toBe(true);
  });
});
