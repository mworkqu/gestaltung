// Secrets for third-party integrations (D6, migration 0072 `integrations`).
//
// encryptSecret / decryptSecret: AES-256-GCM with a random 12-byte IV, sealed as
//   "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>"
// The key is INTEGRATIONS_ENC_KEY: 32 random bytes, base64 (standard or url),
// e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
// Losing / changing the key only means the owner reconnects the channel.
//
// signState / verifyState: the OAuth `state` (CSRF). An HMAC-SHA256 (key derived
// from the same secret, never the raw AES key) over a small JSON payload with
// a random nonce and an issue time; the callback also compares it with the
// httpOnly cookie set when the flow started.
//
// No Next runtime, no env reads (the caller passes the key): unit-tested in
// lib/integrations/crypto.test.ts. Server-only in practice (node:crypto).

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { asLocale } from "@/lib/locale";

const VERSION = "v1";

/** The 32-byte key from its base64 text, or null when missing / wrong size. */
export function parseEncKey(raw: string | undefined | null): Buffer | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  try {
    const buf = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

const b64u = (b: Buffer) => b.toString("base64url");
const fromB64u = (s: string) => Buffer.from(s, "base64url");

export function encryptSecret(plain: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("bad_key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64u(iv), b64u(tag), b64u(ct)].join(".");
}

/** The plain text, or null when the box is malformed, tampered or sealed with another key. */
export function decryptSecret(sealed: string | null | undefined, key: Buffer): string | null {
  if (!sealed || key.length !== 32) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = fromB64u(parts[1]);
    const tag = fromB64u(parts[2]);
    const ct = fromB64u(parts[3]);
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── OAuth state ──────────────────────────────────────────────────────────────

export const STATE_TTL_MS = 10 * 60 * 1000;

export type StatePayload = { n: string; t: number; l: "en" | "ar" };

const stateKey = (key: Buffer) => createHmac("sha256", key).update("gestaltung:oauth-state:v1").digest();

const mac = (body: string, key: Buffer) => createHmac("sha256", stateKey(key)).update(body).digest("base64url");

/** A fresh signed state for the given UI locale. */
export function signState(locale: string, key: Buffer, now: number = Date.now()): string {
  const payload: StatePayload = { n: b64u(randomBytes(16)), t: now, l: asLocale(locale) };
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${mac(body, key)}`;
}

/**
 * The payload when `state` is well-signed, unexpired and equal to the cookie
 * value (both required); otherwise null.
 */
export function verifyState(
  state: string | null | undefined,
  cookie: string | null | undefined,
  key: Buffer,
  now: number = Date.now(),
): StatePayload | null {
  if (!state || !cookie || state.length > 512) return null;
  const a = Buffer.from(state);
  const b = Buffer.from(cookie);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [body, sig, extra] = state.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const want = Buffer.from(mac(body, key));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(fromB64u(body).toString("utf8")) as Partial<StatePayload>;
    if (typeof p.n !== "string" || typeof p.t !== "number" || (p.l !== "en" && p.l !== "ar")) return null;
    if (p.t > now + 60_000 || now - p.t > STATE_TTL_MS) return null;
    return { n: p.n, t: p.t, l: p.l };
  } catch {
    return null;
  }
}
