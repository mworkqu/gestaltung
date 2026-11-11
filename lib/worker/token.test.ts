import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signWorkerToken, verifyWorkerToken, WORKER_TOKEN_TTL_SEC } from "./token";

const SECRET = "k".repeat(48);
const NOW = Date.parse("2026-11-10T12:00:00Z");
const USER = "11111111-2222-4333-8444-555555555555";
const input = { userId: USER, projectId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", tier: "maker", isAdmin: false, isAnonymous: true };

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function forge(header: unknown, payload: unknown, secret = SECRET) {
  const body = `${b64(header)}.${b64(payload)}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

describe("worker token", () => {
  it("round-trips with the expected claims and a 10-minute expiry", () => {
    const { token, claims } = signWorkerToken(input, SECRET, { nowMs: NOW });
    expect(claims.exp - claims.iat).toBe(WORKER_TOKEN_TTL_SEC);
    const r = verifyWorkerToken(token, SECRET, { nowMs: NOW + 60_000 });
    expect(r.ok).toBe(true);
    expect(r.ok && r.claims).toMatchObject({ sub: USER, pid: input.projectId, tier: "maker", adm: false, anon: true, aud: "gestaltung-worker" });
  });

  it("carries no credit or price claim", () => {
    const { claims } = signWorkerToken(input, SECRET, { nowMs: NOW });
    expect(Object.keys(claims).sort()).toEqual(["adm", "anon", "aud", "exp", "iat", "iss", "jti", "pid", "sub", "tier"]);
  });

  it("rejects an expired token, a future token and a wrong audience", () => {
    const { token } = signWorkerToken(input, SECRET, { nowMs: NOW });
    expect(verifyWorkerToken(token, SECRET, { nowMs: NOW + 11 * 60_000 })).toEqual({ ok: false, error: "expired" });
    expect(verifyWorkerToken(token, SECRET, { nowMs: NOW - 5 * 60_000 })).toEqual({ ok: false, error: "not_yet_valid" });
    expect(verifyWorkerToken(token, SECRET, { nowMs: NOW, audience: "other" })).toEqual({ ok: false, error: "bad_audience" });
  });

  it("rejects a tampered payload, a wrong secret and a truncated signature", () => {
    const { token } = signWorkerToken(input, SECRET, { nowMs: NOW });
    const [h, p, s] = token.split(".") as [string, string, string];
    const admin = b64({ ...JSON.parse(Buffer.from(p, "base64url").toString()), adm: true });
    expect(verifyWorkerToken(`${h}.${admin}.${s}`, SECRET, { nowMs: NOW })).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyWorkerToken(token, "z".repeat(48), { nowMs: NOW })).toEqual({ ok: false, error: "bad_signature" });
    expect(verifyWorkerToken(`${h}.${p}.${s.slice(0, -2)}`, SECRET, { nowMs: NOW })).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects alg none / other algorithms, junk and over-long lifetimes", () => {
    const { claims } = signWorkerToken(input, SECRET, { nowMs: NOW });
    expect(verifyWorkerToken(`${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.x`, SECRET, { nowMs: NOW })).toEqual({ ok: false, error: "bad_alg" });
    expect(verifyWorkerToken(forge({ alg: "HS512", typ: "JWT" }, claims), SECRET, { nowMs: NOW })).toEqual({ ok: false, error: "bad_alg" });
    expect(verifyWorkerToken("a.b", SECRET)).toEqual({ ok: false, error: "malformed" });
    expect(verifyWorkerToken("", SECRET)).toEqual({ ok: false, error: "malformed" });
    expect(verifyWorkerToken("a.b.c=", SECRET)).toEqual({ ok: false, error: "malformed" });
    const long = forge({ alg: "HS256", typ: "JWT" }, { ...claims, exp: claims.iat + 86_400 });
    expect(verifyWorkerToken(long, SECRET, { nowMs: NOW })).toEqual({ ok: false, error: "bad_claims" });
    const noSub = forge({ alg: "HS256", typ: "JWT" }, { ...claims, sub: "" });
    expect(verifyWorkerToken(noSub, SECRET, { nowMs: NOW })).toEqual({ ok: false, error: "bad_claims" });
  });

  it("refuses to sign or verify with a short or missing secret", () => {
    expect(() => signWorkerToken(input, "short")).toThrow(/worker_secret_too_short/);
    expect(() => signWorkerToken(input, undefined)).toThrow(/worker_secret_too_short/);
    expect(() => verifyWorkerToken("a.b.c", "")).toThrow(/worker_secret_too_short/);
  });
});
