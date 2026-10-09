import { expect, test } from "./fixtures";

// The write guard itself. It must abort what it promises to abort, and record
// it, without anything leaving the browser. The fixture's own end-of-test check
// is satisfied by emptying the record at the end (these are the only specs that
// do so, on purpose).
test.describe("write guard (production Supabase is behind it)", () => {
  test("aborts Supabase writes, auth sign-ins and app /api writes; records them", async ({ page, guard }) => {
    await page.goto("/en/pricing");

    const results = await page.evaluate(async () => {
      const attempt = async (url: string, init?: RequestInit) => {
        try {
          await fetch(url, init);
          return "sent";
        } catch {
          return "blocked";
        }
      };
      const sb = "https://guard-selftest.supabase.co";
      return {
        insert: await attempt(`${sb}/rest/v1/projects`, { method: "POST", body: "{}" }),
        patch: await attempt(`${sb}/rest/v1/projects?id=eq.x`, { method: "PATCH", body: "{}" }),
        remove: await attempt(`${sb}/rest/v1/projects?id=eq.x`, { method: "DELETE" }),
        rpc: await attempt(`${sb}/rest/v1/rpc/anything`, { method: "POST", body: "{}" }),
        signup: await attempt(`${sb}/auth/v1/signup`, { method: "POST", body: "{}" }),
        token: await attempt(`${sb}/auth/v1/token?grant_type=password`, { method: "POST", body: "{}" }),
        otp: await attempt(`${sb}/auth/v1/otp`, { method: "POST", body: "{}" }),
        apiPost: await attempt("/api/brief-chat", { method: "POST", body: "{}" }),
        apiPut: await attempt("/api/projects/name", { method: "PUT", body: "{}" }),
      };
    });

    expect(results).toEqual({
      insert: "blocked",
      patch: "blocked",
      remove: "blocked",
      rpc: "blocked",
      signup: "blocked",
      token: "blocked",
      otp: "blocked",
      apiPost: "blocked",
      apiPut: "blocked",
    });
    expect(guard.map((a) => `${a.method} ${new URL(a.url).pathname}`)).toEqual([
      "POST /rest/v1/projects",
      "PATCH /rest/v1/projects",
      "DELETE /rest/v1/projects",
      "POST /rest/v1/rpc/anything",
      "POST /auth/v1/signup",
      "POST /auth/v1/token",
      "POST /auth/v1/otp",
      "POST /api/brief-chat",
      "PUT /api/projects/name",
    ]);

    guard.length = 0; // expected here; the fixture would otherwise fail the test
  });

  test("a Supabase GET goes through (reads are allowed)", async ({ page, guard }) => {
    await page.goto("/en/pricing");
    const outcome = await page.evaluate(async () => {
      try {
        // An unreachable .supabase.co host: a GET must reach the network layer
        // (and fail there), it must not be aborted by the guard.
        await fetch("https://guard-selftest.supabase.co/rest/v1/store_settings?select=key&limit=1");
        return "sent";
      } catch {
        return "network-error";
      }
    });
    expect(["sent", "network-error"]).toContain(outcome);
    expect(guard).toEqual([]);
  });
});
