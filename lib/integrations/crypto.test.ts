import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret, parseEncKey, signState, STATE_TTL_MS, verifyState } from "./crypto";

const key = randomBytes(32);
const other = randomBytes(32);

describe("parseEncKey", () => {
  it("accepts 32 bytes in base64 and base64url", () => {
    expect(parseEncKey(key.toString("base64"))?.equals(key)).toBe(true);
    expect(parseEncKey(key.toString("base64url"))?.equals(key)).toBe(true);
    expect(parseEncKey(`  ${key.toString("base64")}\n`)?.equals(key)).toBe(true);
  });
  it("rejects missing or wrong-size keys", () => {
    expect(parseEncKey(undefined)).toBeNull();
    expect(parseEncKey("")).toBeNull();
    expect(parseEncKey(randomBytes(16).toString("base64"))).toBeNull();
    expect(parseEncKey(randomBytes(33).toString("base64"))).toBeNull();
  });
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips and never contains the plain text", () => {
    const token = "1//0gRefreshToken-abc_DEF.123";
    const sealed = encryptSecret(token, key);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(token);
    expect(decryptSecret(sealed, key)).toBe(token);
  });
  it("uses a fresh IV every time", () => {
    expect(encryptSecret("x", key)).not.toBe(encryptSecret("x", key));
  });
  it("returns null for another key, tampering or garbage", () => {
    const sealed = encryptSecret("secret", key);
    expect(decryptSecret(sealed, other)).toBeNull();
    const parts = sealed.split(".");
    const ct = Buffer.from(parts[3], "base64url");
    ct[0] ^= 1;
    expect(decryptSecret([parts[0], parts[1], parts[2], ct.toString("base64url")].join("."), key)).toBeNull();
    expect(decryptSecret("v2.a.b.c", key)).toBeNull();
    expect(decryptSecret("nonsense", key)).toBeNull();
    expect(decryptSecret(null, key)).toBeNull();
  });
  it("refuses a bad key on encrypt", () => {
    expect(() => encryptSecret("x", randomBytes(16))).toThrow();
  });
});

describe("signState / verifyState", () => {
  const now = 1_760_000_000_000;
  it("accepts its own state when it equals the cookie", () => {
    const s = signState("ar", key, now);
    expect(verifyState(s, s, key, now + 1000)).toMatchObject({ l: "ar", t: now });
  });
  it("normalises the locale", () => {
    const s = signState("fr", key, now);
    expect(verifyState(s, s, key, now)?.l).toBe("en");
  });
  it("rejects a cookie mismatch, missing cookie or another key", () => {
    const s = signState("en", key, now);
    const t = signState("en", key, now);
    expect(verifyState(s, t, key, now)).toBeNull();
    expect(verifyState(s, null, key, now)).toBeNull();
    expect(verifyState(s, s, other, now)).toBeNull();
  });
  it("rejects expired and future states", () => {
    const s = signState("en", key, now);
    expect(verifyState(s, s, key, now + STATE_TTL_MS + 1)).toBeNull();
    expect(verifyState(s, s, key, now - 120_000)).toBeNull();
  });
  it("rejects a tampered payload", () => {
    const s = signState("en", key, now);
    const [, sig] = s.split(".");
    const forged = `${Buffer.from(JSON.stringify({ n: "x", t: now, l: "ar" })).toString("base64url")}.${sig}`;
    expect(verifyState(forged, forged, key, now)).toBeNull();
  });
});
