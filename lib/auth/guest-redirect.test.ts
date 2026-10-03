import { describe, expect, it } from "vitest";

import { guestRedirect, hasAccount } from "@/lib/auth/guest-redirect";

const guest = { is_anonymous: true };
const member = { is_anonymous: false };

describe("guestRedirect", () => {
  it("sends a guest from /dashboard and every sub-route to /projects", () => {
    expect(guestRedirect({ user: guest, path: "/dashboard" })).toBe("/projects");
    expect(guestRedirect({ user: guest, path: "/dashboard/credits" })).toBe("/projects");
    expect(guestRedirect({ user: guest, path: "/dashboard/store/orders?x=1" })).toBe("/projects");
  });

  it("sends a guest from /inventory and its sub-routes to /projects", () => {
    expect(guestRedirect({ user: guest, path: "/inventory" })).toBe("/projects");
    expect(guestRedirect({ user: guest, path: "/inventory/new" })).toBe("/projects");
    expect(guestRedirect({ user: guest, path: "/inventory/abc/edit/" })).toBe("/projects");
  });

  it("keeps the locale when the path has one", () => {
    expect(guestRedirect({ user: guest, path: "/ar/dashboard" })).toBe("/ar/projects");
    expect(guestRedirect({ user: guest, path: "/en/inventory/new" })).toBe("/en/projects");
  });

  it("leaves other pages alone, including look-alike paths", () => {
    for (const path of ["/projects", "/ar/projects/abc", "/store", "/my-inventory", "/dashboardx", "/inventories", "/", "/ar"]) {
      expect(guestRedirect({ user: guest, path })).toBeNull();
    }
  });

  it("does not touch a signed-in user", () => {
    expect(guestRedirect({ user: member, path: "/dashboard" })).toBeNull();
    expect(guestRedirect({ user: member, path: "/ar/inventory" })).toBeNull();
    expect(guestRedirect({ user: {}, path: "/dashboard" })).toBeNull();
    expect(guestRedirect({ user: { is_anonymous: null }, path: "/dashboard" })).toBeNull();
  });

  it("does not touch a signed-out visitor (the layouts send them to /sign-in as before)", () => {
    expect(guestRedirect({ user: null, path: "/dashboard" })).toBeNull();
    expect(guestRedirect({ user: undefined, path: "/en/inventory" })).toBeNull();
  });
});

describe("hasAccount", () => {
  it("is true only for a non-anonymous session", () => {
    expect(hasAccount(member)).toBe(true);
    expect(hasAccount({})).toBe(true);
    expect(hasAccount(guest)).toBe(false);
    expect(hasAccount(null)).toBe(false);
    expect(hasAccount(undefined)).toBe(false);
  });
});
