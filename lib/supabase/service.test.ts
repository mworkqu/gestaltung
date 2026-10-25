import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY_VAR = "SUPABASE_SERVICE_ROLE_KEY";

// The module warns on evaluation, so each case re-imports it fresh.
async function load() {
  vi.resetModules();
  return import("@/lib/supabase/service");
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
  vi.unstubAllEnvs();
});

describe("service-role key warning", () => {
  it("warns once, naming the variable, when the key is missing", async () => {
    vi.stubEnv(KEY_VAR, "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://xyz.supabase.co");
    const { createServiceClient } = await load();
    createServiceClient();
    createServiceClient();
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain(KEY_VAR);
    expect(message).toContain("503");
    expect(message).toContain("Vercel");
  });

  it("does not warn when the key is set, and never prints it", async () => {
    vi.stubEnv(KEY_VAR, "secret-service-key");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://xyz.supabase.co");
    const { createServiceClient } = await load();
    createServiceClient();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays quiet during next build", async () => {
    vi.stubEnv(KEY_VAR, "");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    await load();
    expect(warn).not.toHaveBeenCalled();
  });
});
