// logUsage (0101 / audit DB-02): the row is written by the service client with
// the session's verified user id; the old client RPC only before 0101; no
// service key → skipped with one warning. Mocked clients, no Supabase.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { fn: string; args: Record<string, unknown> };
const state: { service: { calls: Call[]; missing: boolean } | null } = { service: null };

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () =>
    state.service && {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.service!.calls.push({ fn, args });
        return state.service!.missing
          ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
          : { data: null, error: null };
      },
    },
}));

const { logUsage } = await import("./usage");

function session(userId: string | null, failFirst = false) {
  const calls: Call[] = [];
  let getUser = 0;
  const client = {
    auth: {
      getUser: async () => {
        getUser++;
        if (failFirst && getUser === 1) throw new Error("auth down");
        return { data: { user: userId ? { id: userId } : null }, error: null };
      },
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: null, error: null };
    },
  };
  return { client: client as never, calls, getUserCalls: () => getUser };
}

const row = { provider: "gemini" as const, feature: "studio" as const, step: "spec", totalTokens: 10, outcome: "ok" as const };

describe("logUsage", () => {
  beforeEach(() => {
    state.service = { calls: [], missing: false };
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("writes through log_ai_usage_server with the session's user id; the session never calls log_ai_usage", async () => {
    const s = session("u-1");
    await logUsage(s.client, row);
    await logUsage(s.client, row);
    expect(state.service!.calls.map((c) => c.fn)).toEqual(["log_ai_usage_server", "log_ai_usage_server"]);
    expect(state.service!.calls[0].args).toMatchObject({ p_user: "u-1", p_feature: "studio", p_step: "spec", p_total_tokens: 10 });
    expect(s.calls).toEqual([]);
    expect(s.getUserCalls()).toBe(1); // cached per session client
  });

  it("before 0101 (no log_ai_usage_server) falls back to the old RPC on the session", async () => {
    state.service!.missing = true;
    const s = session("u-1");
    await logUsage(s.client, row);
    expect(s.calls.map((c) => c.fn)).toEqual(["log_ai_usage"]);
    expect(s.calls[0].args).not.toHaveProperty("p_user");
  });

  it("no service key or no user → nothing written, never throws", async () => {
    state.service = null;
    const s = session("u-1");
    await expect(logUsage(s.client, row)).resolves.toBeUndefined();
    expect(s.calls).toEqual([]);
    state.service = { calls: [], missing: false };
    const anon = session(null);
    await logUsage(anon.client, row);
    expect(state.service.calls).toEqual([]);
  });

  it("uses the verified id the route passes, without another auth.getUser()", async () => {
    const s = session("someone-else");
    await logUsage(s.client, { ...row, userId: "u-verified" });
    expect(state.service!.calls[0].args.p_user).toBe("u-verified");
    expect(s.getUserCalls()).toBe(0);
  });

  it("a failed fallback lookup is not cached for the request", async () => {
    const s = session("u-2", true);
    await logUsage(s.client, row); // auth error → row skipped
    await logUsage(s.client, row); // retried → logged
    expect(state.service!.calls.map((c) => c.args.p_user)).toEqual(["u-2"]);
    expect(s.getUserCalls()).toBe(2);
  });
});
