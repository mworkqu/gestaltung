import { describe, expect, it } from "vitest";

import { DEFAULT_SPEC, type ProductSpec, type StudioComponent } from "../schema";
import { PICK_STAGES, pickStep } from "./progress";
import type { Res, PickReply, SpecReply, StudioApi } from "./api";
import { pickCacheKey, specCacheKey, withStudioCache } from "./cache";

const spec = (over: Partial<ProductSpec> = {}): ProductSpec => ({ ...DEFAULT_SPEC, ...over });
const comp = (id: string): StudioComponent => ({ partId: id, instanceId: `${id}_1`, label: id });

/** Only spec/pick matter here; everything else is never called. */
function fakeApi() {
  const calls = { spec: 0, pick: 0 };
  let failNext = false;
  const api = {
    mode: "mock",
    projectId: "p1",
    async spec(): Promise<Res<SpecReply>> {
      calls.spec++;
      return { ok: true, data: { spec: spec({ name: `card ${calls.spec}` }) } };
    },
    async pick(s: ProductSpec): Promise<Res<PickReply>> {
      calls.pick++;
      await Promise.resolve();
      if (failNext) {
        failNext = false;
        return { ok: false, status: 500, error: "failed" };
      }
      return { ok: true, data: { components: [comp("esp32_devkit"), comp(s.power)], docVersion: 7 } };
    },
  } as unknown as StudioApi;
  return { api, calls, failOnce: () => (failNext = true) };
}

describe("withStudioCache · pick", () => {
  it("the same spec is picked once (back → forward never re-runs it)", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    const first = await api.pick(spec(), "en");
    const again = await api.pick(spec(), "en");
    expect(f.calls.pick).toBe(1);
    expect(again.ok && again.data.components).toEqual(first.ok && first.data.components);
  });

  it("a different spec, or a different language, runs again (Update my parts still works)", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    await api.pick(spec({ power: "usb" }), "en");
    await api.pick(spec({ power: "battery_usb" }), "en");
    await api.pick(spec({ power: "usb" }), "ar");
    expect(f.calls.pick).toBe(3);
    // …and each of those is now cached too, including going back to the first card.
    await api.pick(spec({ power: "usb" }), "en");
    await api.pick(spec({ power: "battery_usb" }), "en");
    expect(f.calls.pick).toBe(3);
  });

  it("is key-order independent for the spec", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    const s = spec();
    const reordered = Object.fromEntries(Object.entries(s).reverse()) as ProductSpec;
    await api.pick(s, "en");
    await api.pick(reordered, "en");
    expect(f.calls.pick).toBe(1);
  });

  it("a repeat carries no server version, so the shell saves the doc itself", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    const first = await api.pick(spec(), "en");
    const again = await api.pick(spec(), "en");
    expect(first.ok && first.data.docVersion).toBe(7);
    expect(again.ok && again.data.docVersion).toBeNull();
  });

  it("a failed pick is not remembered", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    f.failOnce();
    expect((await api.pick(spec(), "en")).ok).toBe(false);
    expect((await api.pick(spec(), "en")).ok).toBe(true);
    expect(f.calls.pick).toBe(2);
  });

  it("two identical calls in flight share one request", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    const [a, b] = await Promise.all([api.pick(spec(), "en"), api.pick(spec(), "en")]);
    expect(f.calls.pick).toBe(1);
    expect(a.ok && b.ok).toBe(true);
  });

  it("hands out copies: changing a result does not change the cache", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    await api.pick(spec(), "en");
    const hit = await api.pick(spec(), "en");
    if (hit.ok) hit.data.components.length = 0;
    const next = await api.pick(spec(), "en");
    expect(next.ok && next.data.components.length).toBeGreaterThan(0);
  });
});

describe("withStudioCache · spec", () => {
  const body = (over = {}) => ({ idea: "plant monitor", messages: [], locale: "en" as const, ...over });

  it("the same chat turn is asked once, a new message asks again", async () => {
    const f = fakeApi();
    const api = withStudioCache(f.api);
    await api.spec(body());
    await api.spec(body());
    expect(f.calls.spec).toBe(1);
    await api.spec(body({ messages: [{ role: "user" as const, text: "make it solar" }], current: spec() }));
    expect(f.calls.spec).toBe(2);
  });

  it("the key ignores our own note lines and the order of keys in the card", () => {
    const s = spec();
    const reordered = Object.fromEntries(Object.entries(s).reverse());
    const a = specCacheKey("p", { idea: "x", locale: "en", current: s, messages: [{ role: "user", text: "hi" }] });
    const b = specCacheKey("p", {
      idea: "x",
      locale: "en",
      current: reordered,
      messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "" }],
    });
    expect(a).toBe(b);
    expect(specCacheKey("p2", { idea: "x", locale: "en", current: s, messages: [{ role: "user", text: "hi" }] })).not.toBe(a);
  });

  // The tier checkpoint, caught by e2e on 2026-10-25: approving sends the SAME turn
  // again with `approveTier`. When the cache ignored that field it answered from the
  // pause it had just stored, so the request never left the browser - nothing was
  // charged, the card never changed, and the modal looked like a dead button.
  it("approving a tier checkpoint is a different question from the pause", () => {
    const base = { idea: "x", locale: "en", current: spec(), messages: [{ role: "user", text: "add a custom pcb" }] };
    const asked = specCacheKey("p", base);
    expect(specCacheKey("p", { ...base, approveTier: "maker" })).not.toBe(asked);
    expect(specCacheKey("p", { ...base, approveTier: "engineer" })).not.toBe(specCacheKey("p", { ...base, approveTier: "maker" }));
    // Not approving anything is still the same question as before.
    expect(specCacheKey("p", { ...base, approveTier: null })).toBe(asked);
  });

  it("a checkpoint is never kept: it is a question, and its balance goes stale", async () => {
    let calls = 0;
    const api = withStudioCache({
      mode: "mock",
      projectId: "p1",
      async spec(): Promise<Res<SpecReply>> {
        calls++;
        return {
          ok: true,
          data: {
            needsApproval: { kind: "escalation", fromTier: "explorer", fromLevel: 1, tier: "maker", level: 2, tokens: 7, balance: 10, reasons: [] },
          },
        } as Res<SpecReply>;
      },
    } as unknown as StudioApi);
    const body = { idea: "x", messages: [], locale: "en" as const, current: spec() };
    await api.spec(body);
    await api.spec(body);
    expect(calls, "the quote must be asked for again, not replayed from the cache").toBe(2);
  });

  it("pick keys differ by project, spec and language", () => {
    const k = pickCacheKey("p", spec(), "en");
    expect(pickCacheKey("p", spec(), "en")).toBe(k);
    expect(pickCacheKey("q", spec(), "en")).not.toBe(k);
    expect(pickCacheKey("p", spec({ name: "other" }), "en")).not.toBe(k);
    expect(pickCacheKey("p", spec(), "ar")).not.toBe(k);
  });
});

describe("pickStep (honest progress)", () => {
  it("starts at 1 and moves over the usual wait", () => {
    expect(pickStep(0)).toBe(1);
    expect(pickStep(-5)).toBe(1);
    expect(pickStep(1000)).toBe(2);
    expect(pickStep(2000)).toBe(3);
    expect(pickStep(4000)).toBe(5);
  });

  it("never claims the last step while still waiting", () => {
    expect(pickStep(5400)).toBe(PICK_STAGES - 1);
    expect(pickStep(60_000)).toBe(PICK_STAGES - 1);
  });
});
