import { readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, LOCALES, msg, test, type Loc } from "./fixtures";

// W8 — speed pass, all behind mocks (Supabase is PRODUCTION: nothing is written).
//
//  1. Studio: the parts pick shows an honest progress line ("Picking your parts… 2 of 6")
//     and going Parts → Idea → Parts again does NOT call the pick again; a changed card
//     ("Update my parts") does. The fixture counts the model calls it is asked for
//     (window.__g360Ai) BELOW the tab cache, so a count that stays put means "cache hit".
//  2. Sign-in: the button is disabled with a spinner and "Signing in…" the moment it is
//     pressed, the page they return to is prefetched while they type, no profiles lookup
//     happens on the way, and a hanging guest claim cannot stall the redirect past its
//     bound (the "Try again" notice takes over).

const ROOT = path.resolve(__dirname, "..");

const PLANT: Record<Loc, string> = {
  en: "automatic small plant watering monitor",
  ar: "جهاز صغير يسقي النبتة تلقائياً",
};
const SOLAR: Record<Loc, string> = { en: "make it solar", ar: "اجعله يعمل بالطاقة الشمسية" };

async function typeWhenHydrated(input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

function aiCounts(page: Page) {
  return page.evaluate(() => (window as unknown as { __g360Ai?: { spec: number; pick: number } }).__g360Ai ?? { spec: -1, pick: -1 });
}

async function declineCookies(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
}

for (const locale of LOCALES) {
  test(`studio: pick shows progress, back→forward never re-runs it, a changed card does [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await declineCookies(page);
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?pickdelay=2600`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, locale);
    const shell = page.getByTestId("studio-shell");

    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await typeWhenHydrated(input, PLANT[locale]);
    await input.press("Enter");
    await page.getByTestId("studio-choices").getByRole("button").first().click();
    await expect(page.getByTestId("studio-idea-summary")).toHaveAttribute("data-state", "spec");
    const specCalls = (await aiCounts(page)).spec;
    expect(specCalls).toBeGreaterThan(0);

    // Parts: the staged progress line is on screen while the (slow) pick runs.
    await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
    await expect(shell).toHaveAttribute("data-step", "parts");
    const progress = page.getByTestId("studio-parts-progress");
    await expect(progress).toBeVisible();
    await expect(progress).toContainText(/[1-5]\D+6|6\D+[1-5]/); // "n of 6" (Arabic: "n من 6", either order)
    const first = Number(await progress.getAttribute("data-step"));
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThanOrEqual(5); // never claims the last step while waiting
    await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible({ timeout: 15_000 });
    await expect(progress).toHaveCount(0);
    expect((await aiCounts(page)).pick).toBe(1);

    // Back to the idea and forward again, twice: the list is the same and nothing is asked again.
    const nav = page.getByRole("navigation", { name: msg(locale, "Studio", "progressLabel") });
    for (let i = 0; i < 2; i++) {
      await nav.getByRole("button").filter({ hasText: msg(locale, "Studio", "step_idea") }).first().click();
      await expect(shell).toHaveAttribute("data-step", "idea");
      await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
      await expect(shell).toHaveAttribute("data-step", "parts");
      await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible();
    }
    expect((await aiCounts(page)).pick).toBe(1);
    expect((await aiCounts(page)).spec).toBe(specCalls);

    // A changed card is a different spec: "Update my parts" asks again (and the new answer is kept).
    await nav.getByRole("button").filter({ hasText: msg(locale, "Studio", "step_idea") }).first().click();
    const refine = page.getByRole("textbox", { name: JSON_CARD(locale, "refinePlaceholder") });
    await typeWhenHydrated(refine, SOLAR[locale]);
    await refine.press("Enter");
    const update = page.getByRole("button", { name: JSON_CARD(locale, "updateParts") });
    await expect(update).toBeVisible();
    await update.click();
    await expect(shell).toHaveAttribute("data-step", "parts");
    await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible({ timeout: 15_000 });
    expect((await aiCounts(page)).pick).toBe(2);

    // …and going back and forth with the new card does not ask a third time.
    await nav.getByRole("button").filter({ hasText: msg(locale, "Studio", "step_idea") }).first().click();
    await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
    await expect(shell).toHaveAttribute("data-step", "parts");
    await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible();
    expect((await aiCounts(page)).pick).toBe(2);
  });
}

/** Nested Studio.ideaCard.* copy (fixtures' msg() reads flat keys only). */
function JSON_CARD(locale: Loc, key: string): string {
  const all = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
    Studio: { ideaCard: Record<string, string> };
  };
  const v = all.Studio.ideaCard[key];
  if (typeof v !== "string") throw new Error(`missing Studio.ideaCard.${key}`);
  return v;
}

// ── Sign-in ───────────────────────────────────────────────────────────────────

function supabaseUrl(): URL {
  let url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
    url = /^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m.exec(env)?.[1]?.trim().replace(/^["']|["']$/g, "");
  }
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return new URL(url);
}
const SUPA = supabaseUrl();
const STORAGE_KEY = `sb-${SUPA.hostname.split(".")[0]}-auth-token`;
const isSupabase = (u: URL) => u.host === SUPA.host;
const GUEST_ID = "aaaaaaaa-0000-4000-8000-00000000e2e3";
const MEMBER_ID = "bbbbbbbb-0000-4000-8000-00000000e2e4";

function fakeJwt(sub: string, anonymous: boolean): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub, aud: "authenticated", role: "authenticated", is_anonymous: anonymous, iat: now, exp: now + 3600, session_id: `${sub}-s` }),
    "e2e-not-a-real-signature",
  ].join(".");
}
function fakeSession(id: string, anonymous: boolean) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: fakeJwt(id, anonymous),
    refresh_token: `e2e-refresh-${id.slice(0, 8)}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email: anonymous ? "" : "e2e-member@example.invalid",
      is_anonymous: anonymous,
      app_metadata: anonymous ? {} : { provider: "email", providers: ["email"] },
      user_metadata: {},
      created_at: "2026-10-11T00:00:00Z",
    },
  };
}

const TOKEN_DELAY_MS = 700;
const CLAIM_HANG_MS = 12_000;

async function setUpSignIn(page: Page, baseURL: string, opts: { claimHangs: boolean }) {
  await page.context().addCookies([
    {
      name: STORAGE_KEY,
      value: `base64-${Buffer.from(JSON.stringify(fakeSession(GUEST_ID, true))).toString("base64url")}`,
      url: baseURL,
    },
  ]);
  await declineCookies(page);
  const seen = { profiles: 0, claims: 0, tokenAt: 0 };
  await page.route(
    (u) => isSupabase(u) && u.pathname.endsWith("/auth/v1/token"),
    async (route) => {
      seen.tokenAt = Date.now();
      await new Promise((r) => setTimeout(r, TOKEN_DELAY_MS));
      await route.fulfill({ status: 200, json: fakeSession(MEMBER_ID, false) });
    },
  );
  await page.route(
    (u) => isSupabase(u) && u.pathname.endsWith("/auth/v1/user"),
    (route) => route.fulfill({ status: 200, json: fakeSession(MEMBER_ID, false).user }),
  );
  await page.route(
    (u) => isSupabase(u) && u.pathname.startsWith("/rest/v1/"),
    (route) => {
      if (route.request().url().includes("/rest/v1/profiles")) seen.profiles++;
      return route.fulfill({ status: 200, contentType: "application/json", body: route.request().method() === "GET" ? "[]" : "null" });
    },
  );
  await page.route("**/api/auth/claim-guest", async (route) => {
    seen.claims++;
    if (opts.claimHangs) {
      await new Promise((r) => setTimeout(r, CLAIM_HANG_MS));
      await route.fulfill({ status: 500, json: { ok: false } }).catch(() => {});
      return;
    }
    await route.fulfill({ status: 200, json: { ok: true, moved: { ok: true, projects: 1 } } });
  });
  return seen;
}

async function fillForm(page: Page, locale: Loc) {
  const form = page.locator("form");
  await typeWhenHydrated(form.getByLabel(msg(locale, "Auth", "emailLabel")), "e2e-member@example.invalid");
  await form.getByLabel(msg(locale, "Auth", "passwordLabel")).fill("not-a-real-password");
  return form.getByRole("button", { name: msg(locale, "Auth", "signInSubmit") });
}

for (const locale of LOCALES) {
  test(`sign-in: instant loading state, prefetch, no profiles lookup, a hanging claim cannot stall the redirect [${locale}]`, async ({ page, baseURL }) => {
    test.setTimeout(90_000);
    const seen = await setUpSignIn(page, baseURL ?? "http://localhost:3000", { claimHangs: true });

    // The page they return to is requested (RSC prefetch) as soon as the form is there.
    const target = `/${locale}/store`;
    const prefetched = page.waitForRequest((r) => new URL(r.url()).pathname === target && r.headers()["rsc"] === "1", { timeout: 20_000 });
    await page.goto(`/${locale}/sign-in?next=${encodeURIComponent(target)}`);
    await expectLocale(page, locale);
    const submit = await fillForm(page, locale);
    await prefetched;

    await submit.click();
    const t0 = Date.now();
    // The very next frame: disabled, busy, spinner and the "Signing in…" label.
    const busy = page.locator("form button[type=submit]");
    await expect(busy).toBeDisabled({ timeout: 300 });
    await expect(busy).toHaveAttribute("aria-busy", "true");
    await expect(busy).toContainText(msg(locale, "Auth", "signingIn"));
    await expect(busy.locator("svg.animate-spin, svg.motion-reduce\\:animate-none")).toBeVisible();

    // Redirect within the claim bound, although the claim itself hangs for 12 s.
    await expect(page).toHaveURL(new RegExp(`${target}$`), { timeout: 9000 });
    const elapsed = Date.now() - t0;
    console.log(`[W8] sign-in click -> redirect (mocked auth ${TOKEN_DELAY_MS} ms, claim hanging): ${elapsed} ms [${locale}]`);
    expect(elapsed).toBeLessThan(7500);
    expect(seen.claims).toBe(1);
    expect(seen.profiles).toBe(0);
    // The pending claim is announced: "Try again" is on offer.
    await expect(page.getByTestId("guest-claim-notice")).toBeVisible();
  });

  test(`sign-in: no role lookup on the way to the dashboard, claim done = no notice [${locale}]`, async ({ page, baseURL }) => {
    test.setTimeout(60_000);
    const seen = await setUpSignIn(page, baseURL ?? "http://localhost:3000", { claimHangs: false });
    await page.goto(`/${locale}/sign-in`);
    await expectLocale(page, locale);
    const submit = await fillForm(page, locale);
    const toDashboard = page.waitForRequest((r) => new URL(r.url()).pathname === `/${locale}/dashboard`, { timeout: 15_000 });
    const t0 = Date.now();
    await submit.click();
    await toDashboard;
    console.log(`[W8] sign-in click -> dashboard request (mocked auth ${TOKEN_DELAY_MS} ms): ${Date.now() - t0} ms [${locale}]`);
    expect(seen.profiles).toBe(0);
    expect(seen.claims).toBe(1);
    await expect(page.getByTestId("guest-claim-notice")).toHaveCount(0);
  });
}
