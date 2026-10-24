import { describe, expect, it } from "vitest";

import { leadAllowedFor } from "./lead-gate";

describe("leadAllowedFor", () => {
  const account = { is_anonymous: false };
  const guest = { is_anonymous: true };

  it("is always allowed while Turnstile is not enforced", () => {
    expect(leadAllowedFor({ enforced: false, user: null, tokenOk: false })).toBe(true);
    expect(leadAllowedFor({ enforced: false, user: guest, tokenOk: false })).toBe(true);
  });

  it("enforced: a passing token is enough, for anyone", () => {
    expect(leadAllowedFor({ enforced: true, user: null, tokenOk: true })).toBe(true);
    expect(leadAllowedFor({ enforced: true, user: guest, tokenOk: true })).toBe(true);
  });

  it("enforced: a signed-in non-anonymous account is exempt", () => {
    expect(leadAllowedFor({ enforced: true, user: account, tokenOk: false })).toBe(true);
    expect(leadAllowedFor({ enforced: true, user: {}, tokenOk: false })).toBe(true);
  });

  it("enforced: an anonymous guest session without a valid token is refused", () => {
    expect(leadAllowedFor({ enforced: true, user: guest, tokenOk: false })).toBe(false);
  });

  it("enforced: no session and no valid token is refused", () => {
    expect(leadAllowedFor({ enforced: true, user: null, tokenOk: false })).toBe(false);
  });
});
