import { readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, test as guarded, type Loc } from "../fixtures";

// ── CAD Champions e2e helpers ───────────────────────────────────────────────
// Every CC spec uses this `test`: it is the read-only `guard` fixture from
// e2e/fixtures.ts (aborts any write to Supabase / auth / non-GET /api) PLUS a
// server-action guard. Server actions are POSTs to the page URL with a
// `Next-Action` header, which the /api guard never sees, so here:
//   - a spec registers a mock with `actions.on((args) => result)`; the POST is
//     answered in the browser with that result (React Flight row), the server
//     never runs the action;
//   - an action with no mock (handler returns undefined) is ABORTED and fails
//     the test after it ends, exactly like the write guard.
// So no CC spec can reach a real action (and through it the production DB).

export { expect, LOCALES };
export type { Loc };

const ROOT = path.resolve(__dirname, "..", "..");

export type ActionCall = { args: unknown[] | null; result: unknown };
export type ActionHandler = (args: unknown[] | null) => unknown;
export type ActionMock = {
  /** Answer server actions; return undefined to leave one unmocked (it is aborted and the test fails). */
  on(handler: ActionHandler): void;
  calls: ActionCall[];
};

/** Strings that start with "$" are escaped in the React Flight format. */
function flightSafe(v: unknown): unknown {
  if (typeof v === "string") return v.startsWith("$") ? `$${v}` : v;
  if (Array.isArray(v)) return v.map(flightSafe);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, flightSafe(x)]));
  return v === undefined ? null : v;
}

/** The body Next.js sends for a server action that returned `value` (no re-render). */
function flightBody(value: unknown): string {
  return `0:${JSON.stringify({ a: flightSafe(value), f: "", b: "e2e" })}\n`;
}

export const test = guarded.extend<{ actions: ActionMock; consent: void }>({
  actions: [
    async ({ context, baseURL }, use) => {
      const appOrigin = new URL(baseURL ?? "http://localhost:3000").origin;
      const calls: ActionCall[] = [];
      const unmocked: string[] = [];
      let handler: ActionHandler | null = null;
      await context.route(
        (url) => url.origin === appOrigin && !url.pathname.startsWith("/_next/") && !url.pathname.startsWith("/api/"),
        async (route) => {
          const req = route.request();
          const actionId = await req.headerValue("next-action");
          if (req.method() !== "POST" || !actionId) return route.fallback();
          let args: unknown[] | null = null;
          try {
            const parsed = JSON.parse(req.postData() ?? "") as unknown;
            args = Array.isArray(parsed) ? parsed : null;
          } catch {
            args = null;
          }
          const result = handler ? handler(args) : undefined;
          if (result === undefined) {
            unmocked.push(`${new URL(req.url()).pathname} ${JSON.stringify(args)?.slice(0, 200)}`);
            return route.abort("blockedbyclient");
          }
          calls.push({ args, result });
          await route.fulfill({ status: 200, headers: { "content-type": "text/x-component" }, body: flightBody(result) });
        },
      );
      await use({
        on(h) {
          handler = h;
        },
        calls,
      });
      expect(unmocked, "a server action ran without a mock (blocked; CC specs never reach a real action)").toEqual([]);
    },
    { auto: true },
  ],
  consent: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
        } catch {
          /* storage blocked */
        }
      });
      await use();
    },
    { auto: true },
  ],
});

// ── Messages (messages/cad-champions/<locale>/<file>.json, nested) ────────────

const cache = new Map<string, Record<string, unknown>>();

/** CC copy by dotted key, e.g. cc("en", "test", "workspace.warn15Title"). */
export function cc(locale: Loc, file: string, key: string): string {
  const id = `${locale}/${file}`;
  let json = cache.get(id);
  if (!json) {
    json = JSON.parse(readFileSync(path.join(ROOT, "messages", "cad-champions", locale, `${file}.json`), "utf8")) as Record<string, unknown>;
    cache.set(id, json);
  }
  const value = key.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), json);
  if (typeof value !== "string") throw new Error(`missing CC message ${locale}:${file}.${key}`);
  return value;
}

/** The fixed text before the first ICU placeholder / tag (for messages with {vars}). */
export function ccStart(locale: Loc, file: string, key: string): string {
  const text = cc(locale, file, key).split(/[{<]/)[0].trim();
  if (text.length < 3) throw new Error(`message ${locale}:${file}.${key} has no usable fixed prefix`);
  return text;
}

// ── Pages ──────────────────────────────────────────────────────────────────

export const fixtureUrl = (locale: Loc, name: string, query = "") => `/cad-champions/${locale}/e2e-fixtures/${name}${query}`;

/** Opens a CC e2e fixture (404 unless the server runs with E2E_FIXTURES=1) and checks lang/dir. */
export async function openFixture(page: Page, locale: Loc, name: string, query = "") {
  const res = await page.goto(fixtureUrl(locale, name, query));
  expect(res?.status(), "start the server with E2E_FIXTURES=1 (fixture routes 404 otherwise)").toBe(200);
  await expectLocale(page, locale);
  await expect(page.getByTestId(`cc-fixture-${name}`)).toBeVisible();
}

/** Opens a real public CC page and checks lang/dir. */
export async function openPublic(page: Page, locale: Loc, p: string) {
  const res = await page.goto(`/cad-champions/${locale}${p}`);
  expect(res?.status()).toBe(200);
  await expectLocale(page, locale);
}

/** No horizontal overflow at either width (the 375 px project is the one that matters). */
export async function layoutOk(page: Page) {
  await expectNoHorizontalOverflow(page);
}

// ── Sample files ───────────────────────────────────────────────────────────

export const STEP_TEXT = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('e2e sample'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";

/** A 1 x 1 PNG (payment proof screenshot). */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
