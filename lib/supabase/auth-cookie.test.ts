import { describe, expect, it } from "vitest";

import { hasSupabaseAuthCookie } from "./auth-cookie";

describe("hasSupabaseAuthCookie", () => {
  it("sees the session cookie, its chunks and the PKCE verifier", () => {
    expect(hasSupabaseAuthCookie(["sb-jgwuafubtmpaonsznfyw-auth-token"])).toBe(true);
    expect(hasSupabaseAuthCookie(["NEXT_LOCALE", "sb-abc-auth-token.0", "sb-abc-auth-token.1"])).toBe(true);
    expect(hasSupabaseAuthCookie(["sb-abc-auth-token-code-verifier"])).toBe(true);
  });

  it("ignores everything else", () => {
    expect(hasSupabaseAuthCookie([])).toBe(false);
    expect(hasSupabaseAuthCookie(["NEXT_LOCALE", "gestaltung_consent", "_ga", "auth-token"])).toBe(false);
  });
});
