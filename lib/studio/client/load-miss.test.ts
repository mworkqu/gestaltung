import { describe, expect, it } from "vitest";

import { isGuestTokenGone, missingProjectError } from "./load-miss";

describe("missingProjectError (F-025)", () => {
  it("treats a missing or fresh anonymous session as a lost guest token", () => {
    expect(missingProjectError(null)).toBe("guest_gone");
    expect(missingProjectError(undefined)).toBe("guest_gone");
    expect(missingProjectError({ is_anonymous: true })).toBe("guest_gone");
  });
  it("keeps not_found for a signed-in account that simply has no such project", () => {
    expect(missingProjectError({ is_anonymous: false })).toBe("not_found");
    expect(missingProjectError({})).toBe("not_found");
  });
  it("groups the errors that need sign-in or start again, never retry", () => {
    expect(isGuestTokenGone("guest_gone")).toBe(true);
    expect(isGuestTokenGone("sign_in")).toBe(true);
    expect(isGuestTokenGone("failed")).toBe(false);
    expect(isGuestTokenGone("not_found")).toBe(false);
  });
});
