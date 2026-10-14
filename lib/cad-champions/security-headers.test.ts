import { describe, expect, it } from "vitest";

import { applyCcSecurityHeaders, CC_SECURITY_HEADERS } from "./security-headers";

describe("CC security headers", () => {
  it("blocks framing by other sites and keeps the CSP to frame-ancestors only", () => {
    expect(CC_SECURITY_HEADERS["Content-Security-Policy"]).toBe("frame-ancestors 'self'");
    expect(CC_SECURITY_HEADERS["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("sets referrer, nosniff and a camera/microphone/geolocation-off permissions policy", () => {
    const h = applyCcSecurityHeaders(new Headers());
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("never touches X-Robots-Tag (noindex stays owned by the middleware)", () => {
    const h = new Headers({ "X-Robots-Tag": "noindex, nofollow" });
    applyCcSecurityHeaders(h);
    expect(h.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(Object.keys(CC_SECURITY_HEADERS).map((k) => k.toLowerCase())).not.toContain("x-robots-tag");
  });

  it("is frozen so no caller can change the shared values", () => {
    expect(Object.isFrozen(CC_SECURITY_HEADERS)).toBe(true);
  });
});
