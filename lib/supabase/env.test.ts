import { afterEach, describe, expect, it, vi } from "vitest";

import { requireSupabaseEnv, supabaseEnv } from "@/lib/supabase/env";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const KEY_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";

afterEach(() => vi.unstubAllEnvs());

describe("supabaseEnv", () => {
  it("returns the pair when both are set", () => {
    vi.stubEnv(URL_VAR, "https://xyz.supabase.co");
    vi.stubEnv(KEY_VAR, "anon-key");
    expect(supabaseEnv()).toEqual({ url: "https://xyz.supabase.co", anonKey: "anon-key" });
  });

  it("returns null when either is missing or empty", () => {
    vi.stubEnv(URL_VAR, "https://xyz.supabase.co");
    vi.stubEnv(KEY_VAR, "");
    expect(supabaseEnv()).toBeNull();
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(KEY_VAR, "anon-key");
    expect(supabaseEnv()).toBeNull();
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(KEY_VAR, "");
    expect(supabaseEnv()).toBeNull();
  });
});

describe("requireSupabaseEnv", () => {
  it("returns the pair when configured", () => {
    vi.stubEnv(URL_VAR, "https://xyz.supabase.co");
    vi.stubEnv(KEY_VAR, "anon-key");
    expect(requireSupabaseEnv()).toEqual({ url: "https://xyz.supabase.co", anonKey: "anon-key" });
  });

  it("names the missing variable", () => {
    vi.stubEnv(URL_VAR, "https://xyz.supabase.co");
    vi.stubEnv(KEY_VAR, "");
    expect(() => requireSupabaseEnv()).toThrow(`${KEY_VAR} is not set`);
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(KEY_VAR, "anon-key");
    expect(() => requireSupabaseEnv()).toThrow(`${URL_VAR} is not set`);
  });

  it("names both when neither is set", () => {
    vi.stubEnv(URL_VAR, "");
    vi.stubEnv(KEY_VAR, "");
    expect(() => requireSupabaseEnv()).toThrow(`${URL_VAR} and ${KEY_VAR} are not set`);
  });
});
