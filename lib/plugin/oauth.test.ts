import { describe, expect, it } from "vitest";

import {
  ALL_PLUGIN_SCOPES,
  audienceAllowed,
  checkTokenClaims,
  mcpResourceUrl,
  PLUGIN_SCOPES,
  scopesFromClaims,
  supabaseIssuer,
  type TokenClaims,
} from "./oauth";

const ISSUER = "https://abcdefgh.supabase.co/auth/v1";
const RESOURCE = "https://gestaltung360.com/api/mcp";
const NOW = new Date("2026-11-23T10:00:00Z");
const SOON = Math.floor(NOW.getTime() / 1000) + 3600;

const claims = (over: TokenClaims = {}): TokenClaims => ({
  sub: "11111111-1111-1111-1111-111111111111",
  iss: ISSUER,
  aud: "authenticated",
  exp: SOON,
  client_id: "cli_123",
  ...over,
});

const check = (over: TokenClaims = {}) => checkTokenClaims(claims(over), { issuer: ISSUER, resource: RESOURCE, now: NOW });

describe("urls", () => {
  it("names the resource and the issuer, trailing slash or not", () => {
    expect(mcpResourceUrl("https://gestaltung360.com")).toBe(RESOURCE);
    expect(mcpResourceUrl("https://gestaltung360.com/")).toBe(RESOURCE);
    expect(supabaseIssuer("https://abcdefgh.supabase.co")).toBe(ISSUER);
  });
});

describe("checkTokenClaims", () => {
  it("accepts a token the OAuth server issued", () => {
    expect(check()).toEqual({
      ok: true,
      userId: "11111111-1111-1111-1111-111111111111",
      clientId: "cli_123",
      scopes: [...ALL_PLUGIN_SCOPES],
      email: null,
      expiresAt: SOON,
    });
  });

  it("refuses a token from an ordinary website sign-in (no client_id)", () => {
    // The whole point: a session token from our own site, or a stolen cookie,
    // was not issued for this endpoint and must not act through a chat.
    expect(check({ client_id: undefined })).toEqual({ ok: false, reason: "not_oauth" });
    expect(check({ client_id: "   " })).toEqual({ ok: false, reason: "not_oauth" });
  });

  it("refuses another project's issuer", () => {
    expect(check({ iss: "https://evil.supabase.co/auth/v1" })).toEqual({ ok: false, reason: "wrong_issuer" });
    expect(check({ iss: undefined })).toEqual({ ok: false, reason: "wrong_issuer" });
  });

  it("ignores a trailing slash on the issuer", () => {
    expect(checkTokenClaims(claims({ iss: `${ISSUER}/` }), { issuer: ISSUER, resource: RESOURCE, now: NOW }).ok).toBe(true);
  });

  it("refuses a guest, a subject-less token and an expired one", () => {
    expect(check({ is_anonymous: true })).toEqual({ ok: false, reason: "guest" });
    expect(check({ sub: undefined })).toEqual({ ok: false, reason: "no_subject" });
    expect(check({ exp: Math.floor(NOW.getTime() / 1000) })).toEqual({ ok: false, reason: "expired" });
  });

  it("accepts a token with no exp at all", () => {
    const r = check({ exp: undefined });
    expect(r.ok).toBe(true);
    expect(r.ok && r.expiresAt).toBeUndefined();
  });

  it("reads the e-mail when the openid scope put one there", () => {
    const r = check({ email: "noora@example.com" });
    expect(r.ok && r.email).toBe("noora@example.com");
  });
});

describe("audience", () => {
  it("accepts Supabase's default aud, which names no resource", () => {
    expect(audienceAllowed("authenticated", RESOURCE)).toBe(true);
    expect(audienceAllowed(undefined, RESOURCE)).toBe(true);
    expect(audienceAllowed(["authenticated"], RESOURCE)).toBe(true);
  });

  it("enforces a URL aud once a custom access token hook sets one", () => {
    expect(audienceAllowed(RESOURCE, RESOURCE)).toBe(true);
    expect(audienceAllowed(`${RESOURCE}/`, RESOURCE)).toBe(true);
    expect(audienceAllowed(["authenticated", RESOURCE], RESOURCE)).toBe(true);
    expect(audienceAllowed("https://someone-else.com/api/mcp", RESOURCE)).toBe(false);
  });

  it("refuses a token minted for another resource server", () => {
    expect(check({ aud: "https://someone-else.com/api/mcp" })).toEqual({ ok: false, reason: "wrong_audience" });
  });
});

describe("scopes", () => {
  it("takes a token at its word when it names ours", () => {
    expect(scopesFromClaims({ scope: "openid email cart:write" })).toEqual([PLUGIN_SCOPES.cart]);
    expect(scopesFromClaims({ scope: "project:write meetings:write" })).toEqual([PLUGIN_SCOPES.project, PLUGIN_SCOPES.meetings]);
  });

  it("grants all three when the token names none of ours (consent was per client)", () => {
    expect(scopesFromClaims({ scope: "openid profile email" })).toEqual([...ALL_PLUGIN_SCOPES]);
    expect(scopesFromClaims({})).toEqual([...ALL_PLUGIN_SCOPES]);
  });

  it("is not fooled by a scope that merely contains one of ours", () => {
    expect(scopesFromClaims({ scope: "cart:write:all" })).toEqual([...ALL_PLUGIN_SCOPES]);
  });
});
