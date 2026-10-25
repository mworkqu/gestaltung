import { describe, expect, it } from "vitest";

import { applyNewPassword, type RecoveryProof } from "./reset-password-server";

// The one place a recovery token is spent: verify, set the password, sign out.
// A fake auth client records what it was asked, so the test proves BOTH routes
// (the link's hash and the emailed code) end in the same two calls.

type Call = { fn: string; args: unknown };

function fakeSupabase(opts: { verifyError?: boolean; updateError?: boolean } = {}) {
  const calls: Call[] = [];
  const client = {
    auth: {
      async verifyOtp(args: unknown) {
        calls.push({ fn: "verifyOtp", args });
        return { error: opts.verifyError ? { message: "Token has expired or is invalid" } : null };
      },
      async updateUser(args: unknown) {
        calls.push({ fn: "updateUser", args });
        return { error: opts.updateError ? { message: "weak" } : null };
      },
      async signOut() {
        calls.push({ fn: "signOut", args: null });
        return { error: null };
      },
    },
  };
  // The real client has far more on it than applyNewPassword touches.
  return { client: client as unknown as Parameters<typeof applyNewPassword>[0], calls };
}

const HASH: RecoveryProof = { tokenHash: "a".repeat(56) };
const CODE: RecoveryProof = { email: "person@example.com", code: "123456" };

describe("applyNewPassword", () => {
  it("spends the link's hash and sets the password in one request", async () => {
    const { client, calls } = fakeSupabase();
    expect(await applyNewPassword(client, HASH, "newpassword")).toBe("ok");
    expect(calls.map((c) => c.fn)).toEqual(["verifyOtp", "updateUser", "signOut"]);
    expect(calls[0]!.args).toEqual({ type: "recovery", token_hash: "a".repeat(56) });
    expect(calls[1]!.args).toEqual({ password: "newpassword" });
  });

  it("spends the 6-digit code with the address it was sent to", async () => {
    const { client, calls } = fakeSupabase();
    expect(await applyNewPassword(client, CODE, "newpassword")).toBe("ok");
    expect(calls[0]!.args).toEqual({ type: "recovery", email: "person@example.com", token: "123456" });
  });

  it("answers 'expired' for a used token and for a wrong code alike", async () => {
    for (const proof of [HASH, CODE]) {
      const { client, calls } = fakeSupabase({ verifyError: true });
      expect(await applyNewPassword(client, proof, "newpassword")).toBe("expired");
      // Nothing is changed and no session is left behind.
      expect(calls.map((c) => c.fn)).toEqual(["verifyOtp"]);
    }
  });

  it("answers 'failed' when the password itself is refused", async () => {
    const { client, calls } = fakeSupabase({ updateError: true });
    expect(await applyNewPassword(client, HASH, "newpassword")).toBe("failed");
    // The recovery session stays, so they can try another password.
    expect(calls.map((c) => c.fn)).toEqual(["verifyOtp", "updateUser"]);
  });
});
