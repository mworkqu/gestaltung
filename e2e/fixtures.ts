import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test as base, type Page } from "@playwright/test";

// ── Production-safe fixtures ────────────────────────────────────────────────
// .env.local points at the PRODUCTION Supabase project, so the suite must never
// create data: no sign-in, no anonymous session, no project / order / lead /
// cart row, no AI call. The `guard` fixture (auto, on every test) aborts, at
// the network layer, anything that could write:
//   - any request to the Supabase host whose method is not GET / HEAD / OPTIONS
//   - any request to /auth/v1/signup, /auth/v1/token, /auth/v1/otp
//   - any non-GET/HEAD/OPTIONS request to the app's own /api/*
// and RECORDS what it aborted. After the test it fails if anything was aborted,
// so a regression that starts writing is caught, not silently hidden.
//
// One known, intended beacon is tolerated (still aborted, never sent):
// POST /api/demand — the product page's "view" demand signal. It is listed in
// BENIGN_BEACONS; anything else fails the test.

export type Aborted = { method: string; url: string; why: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTH_WRITE = /\/auth\/v1\/(signup|token|otp)(\/|$|\?)/;

/** Aborted but expected on a read-only walk (app behaviour, not a test step). */
const BENIGN_BEACONS: { method: string; pathname: string }[] = [{ method: "POST", pathname: "/api/demand" }];

const ROOT = path.resolve(__dirname, "..");

/** NEXT_PUBLIC_SUPABASE_URL from the environment or .env.local (never printed). */
function supabaseHost(): string | null {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    try {
      const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
      url = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
    } catch {
      /* no .env.local */
    }
  }
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const SUPABASE_HOST = supabaseHost();

function classify(u: URL, method: string, appOrigin: string): string | null {
  const m = method.toUpperCase();
  const isSupabase = (SUPABASE_HOST !== null && u.host === SUPABASE_HOST) || u.host.endsWith(".supabase.co");
  if (isSupabase) {
    if (AUTH_WRITE.test(u.pathname)) return "supabase auth write";
    if (!SAFE_METHODS.has(m)) return "supabase non-GET";
    return null;
  }
  if (u.origin === appOrigin && u.pathname.startsWith("/api/") && !SAFE_METHODS.has(m)) return "app /api non-GET";
  return null;
}

export const test = base.extend<{ guard: Aborted[] }>({
  guard: [
    async ({ context, baseURL }, use) => {
      const aborted: Aborted[] = [];
      const appOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
      await context.route(
        (url) => url.host.endsWith(".supabase.co") || (SUPABASE_HOST !== null && url.host === SUPABASE_HOST) || url.pathname.startsWith("/api/"),
        async (route) => {
          const req = route.request();
          const u = new URL(req.url());
          const why = classify(u, req.method(), appOrigin);
          if (why) {
            aborted.push({ method: req.method(), url: `${u.origin}${u.pathname}`, why });
            await route.abort("blockedbyclient");
            return;
          }
          await route.continue();
        },
      );
      await use(aborted);
      const unexpected = aborted.filter(
        (a) => !BENIGN_BEACONS.some((b) => b.method === a.method && new URL(a.url).pathname === b.pathname),
      );
      expect(unexpected, "a write was attempted by a read-only step (blocked by the guard)").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

// ── Helpers ─────────────────────────────────────────────────────────────────

export const LOCALES = ["en", "ar"] as const;
export type Loc = (typeof LOCALES)[number];

type Messages = Record<string, Record<string, string>>;
const cache = new Map<Loc, Messages>();

/** Copy from messages/<locale>.json, so specs never hard-code Arabic strings. */
export function msg(locale: Loc, ns: string, key: string): string {
  let all = cache.get(locale);
  if (!all) {
    all = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as Messages;
    cache.set(locale, all);
  }
  const value = all[ns]?.[key];
  if (typeof value !== "string") throw new Error(`missing message ${locale}:${ns}.${key}`);
  return value;
}

export async function expectLocale(page: Page, locale: Loc) {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
}

/** No horizontal overflow: the document is not wider than the viewport. */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`).toBeLessThanOrEqual(innerWidth);
}
