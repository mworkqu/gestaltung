import { describe, expect, it } from "vitest";

import { parseViewMode, resolveViewMode } from "./view-mode";

describe("view mode", () => {
  it("every non-admin gets the client view, whatever is in storage", () => {
    expect(resolveViewMode({ isAdmin: false, saved: null })).toBe("client");
    expect(resolveViewMode({ isAdmin: false, saved: "engineer" })).toBe("client");
  });

  it("a super_admin opens the engineer view until they choose otherwise, and the choice sticks", () => {
    expect(resolveViewMode({ isAdmin: true, saved: null })).toBe("engineer");
    expect(resolveViewMode({ isAdmin: true, saved: "client" })).toBe("client");
    expect(resolveViewMode({ isAdmin: true, saved: "engineer" })).toBe("engineer");
  });

  it("parses only the two known values", () => {
    expect(parseViewMode("client")).toBe("client");
    expect(parseViewMode("engineer")).toBe("engineer");
    expect(parseViewMode("admin")).toBeNull();
    expect(parseViewMode("")).toBeNull();
    expect(parseViewMode(null)).toBeNull();
    expect(parseViewMode(undefined)).toBeNull();
  });
});
