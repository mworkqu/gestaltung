import { afterEach, describe, expect, it, vi } from "vitest";

import { claimGuestWorkBounded } from "./claim-guest-client";

// W8: sign-in waits for the guest claim, but never longer than a short bound.
// (sessionStorage / window do not exist in the node test environment; the client
// code treats that as "storage blocked", which is exactly the path under test.)

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(handler: () => Promise<{ ok: boolean }>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("claimGuestWorkBounded", () => {
  it("a quick claim finishes inside the bound", async () => {
    stubFetch(async () => ({ ok: true }));
    const late = vi.fn();
    expect(await claimGuestWorkBounded("tok", { ms: 500, onLateDone: late })).toBe(true);
    expect(late).not.toHaveBeenCalled();
  });

  it("a failed claim answers false (the notice + retry take over)", async () => {
    stubFetch(async () => ({ ok: false }));
    expect(await claimGuestWorkBounded("tok", { ms: 500 })).toBe(false);
  });

  it("a slow claim lets sign-in go on, then reports when it lands", async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    stubFetch(() => new Promise((r) => (release = r)));
    const late = vi.fn();
    const t0 = Date.now();
    expect(await claimGuestWorkBounded("tok", { ms: 30, onLateDone: late })).toBe(false);
    expect(Date.now() - t0).toBeLessThan(400);
    expect(late).not.toHaveBeenCalled();
    release({ ok: true });
    await vi.waitFor(() => expect(late).toHaveBeenCalledTimes(1));
  });

  it("a slow claim that then fails does not call onLateDone", async () => {
    let release: (v: { ok: boolean }) => void = () => {};
    stubFetch(() => new Promise((r) => (release = r)));
    const late = vi.fn();
    expect(await claimGuestWorkBounded("tok", { ms: 20, onLateDone: late })).toBe(false);
    release({ ok: false });
    await new Promise((r) => setTimeout(r, 30));
    expect(late).not.toHaveBeenCalled();
  });
});
