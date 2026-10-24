import { describe, expect, it } from "vitest";

import { buildCsp, securityHeaders } from "@/lib/security/headers.mjs";

const NAMES = [
  "Content-Security-Policy-Report-Only",
  "Strict-Transport-Security",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
];

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("securityHeaders (WEB-03)", () => {
  it("returns every expected header with a value", () => {
    const headers = securityHeaders({ supabaseUrl: "https://abc.supabase.co", isDev: false });
    expect(headers.map((h) => h.key)).toEqual(NAMES);
    for (const h of headers) expect(h.value.length).toBeGreaterThan(0);
    const get = (k: string) => headers.find((h) => h.key === k)?.value;
    expect(get("X-Content-Type-Options")).toBe("nosniff");
    expect(get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("puts the Supabase origin (https and wss) in connect-src and media-src", () => {
    const csp = buildCsp({ supabaseUrl: "https://abc.supabase.co/rest/v1", isDev: false });
    expect(directive(csp, "connect-src")).toContain("https://abc.supabase.co");
    expect(directive(csp, "connect-src")).toContain("wss://abc.supabase.co");
    expect(directive(csp, "media-src")).toContain("https://abc.supabase.co");
  });

  it("reads NEXT_PUBLIC_SUPABASE_URL from the environment by default", () => {
    const before = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://xyz.supabase.co";
    try {
      expect(directive(buildCsp(), "connect-src")).toContain("https://xyz.supabase.co");
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = before;
    }
  });

  it("survives a missing or malformed Supabase URL", () => {
    for (const supabaseUrl of ["", "not a url"]) {
      const csp = buildCsp({ supabaseUrl, isDev: false });
      expect(directive(csp, "connect-src").startsWith("connect-src 'self' https://")).toBe(true);
      expect(csp).not.toContain("undefined");
    }
  });

  it("keeps the baseline directives and only relaxes eval in dev", () => {
    const prod = buildCsp({ supabaseUrl: "", isDev: false });
    for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'", "base-uri 'self'", "upgrade-insecure-requests"]) {
      expect(prod).toContain(d);
    }
    expect(directive(prod, "script-src")).toContain("'wasm-unsafe-eval'");
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    const dev = buildCsp({ supabaseUrl: "", isDev: true });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("adds vercel.live only on preview deployments", () => {
    expect(buildCsp({ isDev: false, isPreview: false })).not.toContain("vercel.live");
    expect(directive(buildCsp({ isDev: false, isPreview: true }), "frame-src")).toContain("https://vercel.live");
  });
});
