import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Consolidation 2.5: an anonymous request (no sb-…-auth-token cookie) must make
// ZERO network calls in middleware.ts — no fetch, no Supabase client. Every
// middleware invocation is billed on Vercel, and a network round trip there
// would also slow every cached page. A request WITH an auth cookie is the
// positive control: the same mocks see the Supabase client being created.

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } })),
  createClient: vi.fn(),
  createBrowserClient: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient, createBrowserClient: mocks.createBrowserClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import middleware, { config } from "@/middleware";

const fetchSpy = vi.fn(async () => new Response("unexpected", { status: 500 }));
const env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };

beforeAll(() => {
  // Configured Supabase, so a skipped refresh is the cookie check's doing, not a missing env.
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test-key";
  vi.stubGlobal("fetch", fetchSpy);
});
afterAll(() => {
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_SUPABASE_URL = env.url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.key;
});
beforeEach(() => {
  fetchSpy.mockClear();
  mocks.createServerClient.mockClear();
  mocks.createClient.mockClear();
  mocks.createBrowserClient.mockClear();
});

const ORIGIN = "https://gestaltung360.com";
const request = (path: string, cookies: Record<string, string> = {}) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: Object.keys(cookies).length
      ? { cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ") }
      : {},
  });

/** The matcher as Next applies it: the pattern must match the whole pathname. */
const matched = (path: string) => config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

const expectNoNetwork = () => {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(mocks.createServerClient).not.toHaveBeenCalled();
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(mocks.createBrowserClient).not.toHaveBeenCalled();
};

describe("middleware: anonymous requests make no network call", () => {
  it.each([
    ["a locale page", "/en/store"],
    ["an Arabic product page", "/ar/store/VLT-31976620458086"],
    ["the bare root (locale redirect)", "/"],
    ["a public CAD Champions page", "/cad-champions/en"],
    ["a protected CAD Champions page (sign-in redirect)", "/cad-champions/en/training"],
    ["an internal CAD Champions path (redirect)", "/en/cad-champions"],
  ])("%s: %s", async (_label, path) => {
    expect(matched(path)).toBe(true);
    const res = await middleware(request(path, { NEXT_LOCALE: "ar", cc_locale: "en", _ga: "x" }));
    expect(res.status).toBeLessThan(500);
    expectNoNetwork();
  });

  it("an /api path: the matcher skips it, and even a direct call makes no network call", async () => {
    // No /api path is covered by the matcher ("(?!api|…)"), so middleware never
    // runs for the API; called directly anyway, it still reaches nothing.
    expect(matched("/api/store/search")).toBe(false);
    expect(matched("/api/cron/voltaat-sync")).toBe(false);
    await middleware(request("/api/store/search?q=led"));
    expectNoNetwork();
  });

  it("positive control: with an auth cookie the session refresh does create a client", async () => {
    await middleware(request("/en/store", { "sb-example-auth-token": "base64-e30" }));
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled(); // the mocked client never fetches
  });
});
