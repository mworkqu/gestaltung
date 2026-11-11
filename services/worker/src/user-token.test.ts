import { describe, expect, it } from "vitest";

import { signWorkerToken } from "@/lib/worker/token";

import { verifyUserToken } from "./user-token";

const SECRET = "q".repeat(40);
const NOW = Date.parse("2026-11-10T09:00:00Z");

describe("verifyUserToken", () => {
  const { token } = signWorkerToken({ userId: "u-1", projectId: null, tier: null, isAdmin: true, isAnonymous: false }, SECRET, { nowMs: NOW });

  it("accepts a Bearer token minted with the same secret", () => {
    const r = verifyUserToken(`Bearer ${token}`, SECRET, { nowMs: NOW + 1000 });
    expect(r.ok && r.claims.sub).toBe("u-1");
    expect(r.ok && r.claims.adm).toBe(true);
  });

  it("refuses a missing / non-Bearer header, a wrong secret and an expired token", () => {
    expect(verifyUserToken(undefined, SECRET)).toEqual({ ok: false, error: "malformed" });
    expect(verifyUserToken(token, SECRET)).toEqual({ ok: false, error: "malformed" });
    expect(verifyUserToken(`Basic ${token}`, SECRET)).toEqual({ ok: false, error: "malformed" });
    expect(verifyUserToken(`Bearer ${token}`, "r".repeat(40), { nowMs: NOW })).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyUserToken(`Bearer ${token}`, SECRET, { nowMs: NOW + 20 * 60_000 })).toEqual({ ok: false, error: "expired" });
  });

  it("uses the first value of a repeated header", () => {
    expect(verifyUserToken([`Bearer ${token}`, "Bearer x"], SECRET, { nowMs: NOW }).ok).toBe(true);
  });
});
