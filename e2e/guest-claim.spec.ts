import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Locator, Page, Request } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, supabaseUrl, test, type Loc } from "./fixtures";

// W1 (2026-10-11): a guest who signs in to an EXISTING account comes back to the
// same Studio step and their work is claimed for the account.
//
// Supabase is PRODUCTION, so nothing here reaches it with a write: the guest is a
// FAKE anonymous session cookie (never valid on the server), and every browser
// call to Supabase (auth token, REST, RPC) plus POST /api/auth/claim-guest is
// answered by page.route mocks, which run before the write guard in fixtures.ts.
// The Studio is the test-only fixture (/{locale}/e2e-fixtures/studio) with
// ?store=1 (the doc lives in this tab's sessionStorage, so it survives the trip
// to the sign-in page) and ?gate=sign_in (drawing the wiring answers "sign in
// first", as it does for a guest on the live site).
//
// What the route itself checks (anonymous token, real account, different users)
// is unit-tested in lib/auth/claim-guest.test.ts; the SQL move is migration 0071.

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.resolve(ROOT, "test-results", "w1-guest-claim");

const IDEA: Record<Loc, string> = {
  en: "A little desk friend that lights up when I walk in",
  ar: "رفيق صغير للمكتب يضيء عندما أدخل",
};

const GUEST_ID = "aaaaaaaa-0000-4000-8000-00000000e2e1";
const MEMBER_ID = "bbbbbbbb-0000-4000-8000-00000000e2e2";

// Without a Supabase URL (no .env.local in this checkout) these specs cannot
// run: the app has no Supabase client to intercept. Skip the file instead of
// crashing the whole run.
const SUPA_OR_NULL = supabaseUrl();
test.skip(!SUPA_OR_NULL, "NEXT_PUBLIC_SUPABASE_URL is not set");
const SUPA = SUPA_OR_NULL ?? new URL("http://supabase.invalid");
const STORAGE_KEY = `sb-${SUPA.hostname.split(".")[0]}-auth-token`;

/** An unsigned, JWT-shaped token (never valid on any server). */
function fakeJwt(sub: string, anonymous: boolean): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  return [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub, aud: "authenticated", role: "authenticated", is_anonymous: anonymous, iat: now, exp: now + 3600, session_id: `${sub}-s` }),
    "e2e-not-a-real-signature",
  ].join(".");
}

function fakeUser(id: string, anonymous: boolean) {
  return {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: anonymous ? "" : "e2e-member@example.invalid",
    is_anonymous: anonymous,
    app_metadata: anonymous ? {} : { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-10-11T00:00:00Z",
  };
}

function fakeSession(id: string, anonymous: boolean) {
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: fakeJwt(id, anonymous),
    refresh_token: `e2e-refresh-${id.slice(0, 8)}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: fakeUser(id, anonymous),
  };
}

const GUEST_SESSION = fakeSession(GUEST_ID, true);
const MEMBER_SESSION = fakeSession(MEMBER_ID, false);

const isSupabase = (u: URL) => u.host === SUPA.host;

/**
 * The guest's (fake) anonymous session cookie + mocks for every browser call to
 * Supabase. Returns the claim requests seen and a switch for the claim answer.
 */
async function setUpGuest(page: Page, baseURL: string) {
  await page.context().addCookies([
    {
      name: STORAGE_KEY,
      value: `base64-${Buffer.from(JSON.stringify(GUEST_SESSION)).toString("base64url")}`,
      url: baseURL,
    },
  ]);
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });

  // Sign in to the "existing account".
  await page.route(
    (u) => isSupabase(u) && u.pathname.endsWith("/auth/v1/token"),
    async (route) => {
      const grant = new URL(route.request().url()).searchParams.get("grant_type");
      if (grant !== "password") return route.fulfill({ status: 400, json: { error: "unexpected_grant" } });
      await route.fulfill({ status: 200, json: MEMBER_SESSION });
    },
  );
  await page.route(
    (u) => isSupabase(u) && u.pathname.endsWith("/auth/v1/user"),
    (route) => route.fulfill({ status: 200, json: fakeUser(MEMBER_ID, false) }),
  );
  // Header / cart reads and RPCs: empty answers, nothing reaches production.
  await page.route(
    (u) => isSupabase(u) && u.pathname.startsWith("/rest/v1/"),
    (route) => route.fulfill({ status: 200, contentType: "application/json", body: route.request().method() === "GET" ? "[]" : "null" }),
  );

  const claims: { token: string }[] = [];
  let claimStatus = 200;
  await page.route("**/api/auth/claim-guest", async (route) => {
    const req: Request = route.request();
    claims.push(JSON.parse(req.postData() ?? "{}"));
    await route.fulfill(
      claimStatus === 200
        ? { status: 200, json: { ok: true, moved: { ok: true, projects: 1 } } }
        : { status: claimStatus, json: { ok: false, error: "claim_failed" } },
    );
  });
  return {
    claims,
    setClaimStatus(s: number) {
      claimStatus = s;
    },
  };
}

async function typeWhenHydrated(input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Guest walks the fixture Studio to the Wiring step and is asked to sign in. */
async function guestToWiringGate(page: Page, locale: Loc) {
  const res = await page.goto(`/${locale}/e2e-fixtures/studio?store=1&gate=sign_in`);
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  await expectLocale(page, locale);
  const shell = page.getByTestId("studio-shell");
  await expect(shell).toHaveAttribute("data-step", "idea");

  const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
  await typeWhenHydrated(input, IDEA[locale]);
  await input.press("Enter");
  await page.getByTestId("studio-choices").getByRole("button").first().click();
  await expect(page.getByTestId("studio-idea-summary")).toBeVisible();
  await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
  await expect(shell).toHaveAttribute("data-step", "parts");
  await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
  await expect(shell).toHaveAttribute("data-step", "wiring");
  await expect(page).toHaveURL(/[?&]step=wiring/);

  await page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") }).click();
  const signIn = shell.getByRole("link", { name: msg(locale, "Credits", "signInCta") });
  await expect(signIn).toBeVisible();
  return { shell, signIn };
}

async function signInOnForm(page: Page, locale: Loc) {
  await expect(page).toHaveURL(new RegExp(`/${locale}/sign-in\\?next=`));
  await expectLocale(page, locale);
  // (The "…with your project" intro shows for /projects/… pages only: unit-tested in next-path.test.ts.)
  // "Create one" keeps the way back too.
  await expect(page.getByRole("link", { name: msg(locale, "Auth", "signUpLink") })).toHaveAttribute("href", /next=/);
  const form = page.locator("form");
  await typeWhenHydrated(form.getByLabel(msg(locale, "Auth", "emailLabel")), "e2e-member@example.invalid");
  await form.getByLabel(msg(locale, "Auth", "passwordLabel")).fill("not-a-real-password");
  await form.getByRole("button", { name: msg(locale, "Auth", "signInSubmit") }).click();
}

async function shot(page: Page, project: string, locale: Loc, name: string) {
  const dir = path.join(SHOTS, `${project}-${locale}`);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

for (const locale of LOCALES) {
  test(`guest signs in on a Studio step and comes back to it, work claimed [${locale}]`, async ({ page, baseURL }, info) => {
    test.setTimeout(120_000);
    const mocks = await setUpGuest(page, baseURL ?? "http://localhost:3000");
    const { signIn } = await guestToWiringGate(page, locale);

    // The link carries the way back, including the step.
    const href = await signIn.getAttribute("href");
    const next = new URL(href ?? "", "http://x").searchParams.get("next") ?? "";
    expect(next).toMatch(new RegExp(`^/${locale}/e2e-fixtures/studio\\?`));
    expect(next).toContain("step=wiring");

    await shot(page, info.project.name, locale, "1-wiring-gate");
    await signIn.click();
    await expect(page).toHaveURL(/\/sign-in\?next=/);
    await expect(page.locator("form")).toBeVisible();
    await shot(page, info.project.name, locale, "1b-sign-in");
    await signInOnForm(page, locale);

    // Back on the same step, same project, with the guest token handed to the claim route.
    await expect(page).toHaveURL(new RegExp(`/${locale}/e2e-fixtures/studio\\?.*step=wiring`));
    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "wiring");
    await expect(page.getByTestId("guest-claim-notice")).toHaveCount(0);
    expect(mocks.claims).toHaveLength(1);
    expect(mocks.claims[0].token).toBe(GUEST_SESSION.access_token);
    await expectNoHorizontalOverflow(page);
    await shot(page, info.project.name, locale, "2-back-on-wiring");
  });

  test(`a failed claim still lands on the step and offers "Try again" [${locale}]`, async ({ page, baseURL }, info) => {
    test.setTimeout(120_000);
    const mocks = await setUpGuest(page, baseURL ?? "http://localhost:3000");
    mocks.setClaimStatus(500);
    const { signIn } = await guestToWiringGate(page, locale);
    await signIn.click();
    await signInOnForm(page, locale);

    await expect(page).toHaveURL(new RegExp(`/${locale}/e2e-fixtures/studio\\?.*step=wiring`));
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "wiring");
    const notice = page.getByTestId("guest-claim-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(msg(locale, "GuestClaim", "title"));
    await expectNoHorizontalOverflow(page);
    await shot(page, info.project.name, locale, "3-claim-failed-notice");

    // Try again: the same guest token is sent; on success the page reloads without the notice.
    mocks.setClaimStatus(200);
    await notice.getByRole("button", { name: msg(locale, "GuestClaim", "tryAgain") }).click();
    await expect(page.getByTestId("guest-claim-notice")).toHaveCount(0);
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "wiring");
    expect(mocks.claims.length).toBeGreaterThanOrEqual(2);
    expect(mocks.claims.every((c) => c.token === GUEST_SESSION.access_token)).toBe(true);
  });
}
