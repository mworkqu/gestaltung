import { describe, expect, it } from "vitest";

import { applyCcSecurityHeaders, ccFramingAllowed, CC_SECURITY_HEADERS } from "./security-headers";

describe("CC security headers", () => {
  it("blocks all framing and keeps the CSP to frame-ancestors only", () => {
    expect(CC_SECURITY_HEADERS["Content-Security-Policy"]).toBe("frame-ancestors 'none'");
    expect(CC_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    const h = applyCcSecurityHeaders(new Headers(), "/test/abc");
    expect(h.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(h.get("x-frame-options")).toBe("DENY");
  });

  it("lets only the shared result page be framed (other headers stay)", () => {
    expect(ccFramingAllowed("/results/share/tok_abc")).toBe(true);
    expect(ccFramingAllowed("/results/share/tok_abc/")).toBe(true);
    for (const p of [undefined, "/", "/results", "/results/abc", "/results/share", "/results/share/a/b", "/admin/results/share/x"]) {
      expect(ccFramingAllowed(p), String(p)).toBe(false);
    }
    const h = applyCcSecurityHeaders(new Headers({ "X-Frame-Options": "DENY" }), "/results/share/tok_abc");
    expect(h.get("x-frame-options")).toBeNull();
    expect(h.get("content-security-policy")).toBeNull();
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
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
