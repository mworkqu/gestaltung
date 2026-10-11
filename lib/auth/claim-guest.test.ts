import { describe, expect, it, vi } from "vitest";

import { handleClaimGuest, isMissingFunction, readClaimToken, sameOrigin, type ClaimDeps } from "@/lib/auth/claim-guest";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJndWVzdCJ9.c2lnbmF0dXJlLXBhcnQ";
const GUEST = { id: "11111111-1111-4111-8111-111111111111", is_anonymous: true };
const MEMBER = { id: "22222222-2222-4222-8222-222222222222", is_anonymous: false };

function deps(over: Partial<ClaimDeps> = {}): ClaimDeps & { claim: ReturnType<typeof vi.fn> } {
  const claim = vi.fn(async () => ({ ok: true as const, data: { ok: true, projects: 1 } }));
  return {
    sessionUser: async () => MEMBER,
    userFromToken: async () => GUEST,
    claim,
    ...over,
  } as ClaimDeps & { claim: ReturnType<typeof vi.fn> };
}

describe("readClaimToken", () => {
  it("accepts a JWT-shaped token only", () => {
    expect(readClaimToken({ token: TOKEN })).toBe(TOKEN);
    expect(readClaimToken({ token: "short" })).toBeNull();
    expect(readClaimToken({ token: "a.b" })).toBeNull();
    expect(readClaimToken({ token: `${TOKEN} ` })).toBeNull();
    expect(readClaimToken({ token: 42 })).toBeNull();
    expect(readClaimToken(null)).toBeNull();
    expect(readClaimToken("token")).toBeNull();
  });
});

describe("handleClaimGuest", () => {
  it("moves the guest's work to the signed-in account", async () => {
    const d = deps();
    const r = await handleClaimGuest({ token: TOKEN }, d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, moved: { projects: 1 } });
    expect(d.claim).toHaveBeenCalledWith(GUEST.id, MEMBER.id);
  });

  it("ignores any user id the browser sends", async () => {
    const d = deps();
    await handleClaimGuest({ token: TOKEN, from: "x", to: "y", p_from: "x" }, d);
    expect(d.claim).toHaveBeenCalledWith(GUEST.id, MEMBER.id);
  });

  it("refuses a missing or malformed token without calling anything", async () => {
    const d = deps({ sessionUser: vi.fn(async () => MEMBER) });
    expect((await handleClaimGuest({}, d)).status).toBe(400);
    expect((await handleClaimGuest({ token: "nope" }, d)).status).toBe(400);
    expect(d.sessionUser).not.toHaveBeenCalled();
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("needs a signed-in session", async () => {
    const d = deps({ sessionUser: async () => null });
    const r = await handleClaimGuest({ token: TOKEN }, d);
    expect(r).toEqual({ status: 401, body: { ok: false, error: "sign_in" } });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("refuses when the session itself is still a guest", async () => {
    const d = deps({ sessionUser: async () => ({ id: MEMBER.id, is_anonymous: true }) });
    expect((await handleClaimGuest({ token: TOKEN }, d)).body.error).toBe("not_an_account");
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("refuses a token that does not verify", async () => {
    const d = deps({ userFromToken: async () => null });
    const r = await handleClaimGuest({ token: TOKEN }, d);
    expect(r).toEqual({ status: 401, body: { ok: false, error: "invalid_token" } });
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("refuses a token of a real account (cannot steal another account's work)", async () => {
    const d = deps({ userFromToken: async () => ({ id: "33333333-3333-4333-8333-333333333333", is_anonymous: false }) });
    expect((await handleClaimGuest({ token: TOKEN }, d)).body.error).toBe("not_guest");
    const d2 = deps({ userFromToken: async () => ({ id: "33333333-3333-4333-8333-333333333333" }) });
    expect((await handleClaimGuest({ token: TOKEN }, d2)).body.error).toBe("not_guest");
    expect(d.claim).not.toHaveBeenCalled();
    expect(d2.claim).not.toHaveBeenCalled();
  });

  it("refuses the same user on both sides", async () => {
    const d = deps({
      sessionUser: async () => ({ id: GUEST.id, is_anonymous: false }),
      userFromToken: async () => GUEST,
    });
    expect((await handleClaimGuest({ token: TOKEN }, d)).body.error).toBe("same_user");
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("reports a missing migration and a failed claim", async () => {
    const missing = deps({ claim: vi.fn(async () => ({ ok: false as const, missing: true })) });
    expect(await handleClaimGuest({ token: TOKEN }, missing)).toEqual({ status: 503, body: { ok: false, error: "run_0071" } });
    const failed = deps({ claim: vi.fn(async () => ({ ok: false as const, message: "boom" })) });
    expect(await handleClaimGuest({ token: TOKEN }, failed)).toEqual({ status: 500, body: { ok: false, error: "claim_failed" } });
  });

  it("passes on the RPC's own refusal", async () => {
    const d = deps({ claim: vi.fn(async () => ({ ok: true as const, data: { ok: false, reason: "guest_missing" } })) });
    expect(await handleClaimGuest({ token: TOKEN }, d)).toEqual({
      status: 409,
      body: { ok: false, error: "claim_failed", reason: "guest_missing" },
    });
  });

  it("is safe to call twice (the RPC moves nothing the second time)", async () => {
    let n = 0;
    const d = deps({ claim: vi.fn(async () => ({ ok: true as const, data: { ok: true, projects: n++ === 0 ? 1 : 0 } })) });
    expect((await handleClaimGuest({ token: TOKEN }, d)).status).toBe(200);
    const second = await handleClaimGuest({ token: TOKEN }, d);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ ok: true, moved: { projects: 0 } });
  });
});

describe("isMissingFunction", () => {
  it("spots PostgREST / Postgres missing-function errors", () => {
    expect(isMissingFunction({ code: "PGRST202" })).toBe(true);
    expect(isMissingFunction({ code: "42883" })).toBe(true);
    expect(isMissingFunction({ message: "Could not find the function public.claim_guest_work" })).toBe(true);
    expect(isMissingFunction({ code: "23505" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe("sameOrigin", () => {
  it("allows no Origin and a matching one, refuses others", () => {
    expect(sameOrigin(null, "gestaltung360.com")).toBe(true);
    expect(sameOrigin("https://gestaltung360.com", "gestaltung360.com")).toBe(true);
    expect(sameOrigin("http://localhost:3101", "localhost:3101")).toBe(true);
    expect(sameOrigin("https://evil.example", "gestaltung360.com")).toBe(false);
    expect(sameOrigin("null", "gestaltung360.com")).toBe(false);
    expect(sameOrigin("https://gestaltung360.com", null)).toBe(false);
  });
});
