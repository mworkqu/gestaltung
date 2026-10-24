import { describe, expect, it } from "vitest";

import { supabaseCookieOptions } from "@/lib/supabase/cookie-options";

describe("supabaseCookieOptions (WEB-04)", () => {
  it("marks the auth cookies Secure in production", () => {
    expect(supabaseCookieOptions("production")).toEqual({ secure: true });
  });

  it("leaves them non-Secure in development and tests (http://localhost)", () => {
    expect(supabaseCookieOptions("development")).toEqual({ secure: false });
    expect(supabaseCookieOptions("test")).toEqual({ secure: false });
    expect(supabaseCookieOptions(undefined)).toEqual({ secure: false });
  });

  it("does not override the library defaults for sameSite, path, httpOnly or maxAge", () => {
    const o = supabaseCookieOptions("production");
    for (const k of ["sameSite", "path", "httpOnly", "maxAge", "name", "domain"]) expect(o).not.toHaveProperty(k);
  });

  it("reads NODE_ENV from process.env by default", () => {
    expect(supabaseCookieOptions().secure).toBe(process.env.NODE_ENV === "production");
  });
});
