import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, supabaseUrl, test } from "./fixtures";

// 2026-10-12: a product project (made with "Plan a product") opens straight in the
// Studio from My projects; a drawing / store list project keeps the project page.
//
// Supabase is PRODUCTION: the signed-in member is a FAKE session cookie (never valid on
// the server) and every browser call to Supabase is answered by page.route mocks, which
// run before the write guard. Nothing is written anywhere. (The server-side redirect of
// /projects/<id> needs a real session; its rule is unit-tested in lib/projects/href.test.ts.)

const MEMBER_ID = "bbbbbbbb-0000-4000-8000-00000000e2e3";
const PRODUCT_ID = "11111111-0000-4000-8000-00000000e2e4";
const CONSENT_ID = "22222222-0000-4000-8000-00000000e2e5";
const DRAWING_ID = "33333333-0000-4000-8000-00000000e2e6";

// Without a Supabase URL (no .env.local in this checkout) these specs cannot
// run: the app has no Supabase client to intercept. Skip the file instead of
// crashing the whole run.
const SUPA_OR_NULL = supabaseUrl();
test.skip(!SUPA_OR_NULL, "NEXT_PUBLIC_SUPABASE_URL is not set");
const SUPA = SUPA_OR_NULL ?? new URL("http://supabase.invalid");
const STORAGE_KEY = `sb-${SUPA.hostname.split(".")[0]}-auth-token`;

function fakeSession(id: string) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const jwt = [
    b64({ alg: "HS256", typ: "JWT" }),
    b64({ sub: id, aud: "authenticated", role: "authenticated", is_anonymous: false, iat: now, exp: now + 3600, session_id: `${id}-s` }),
    "e2e-not-a-real-signature",
  ].join(".");
  return {
    access_token: jwt,
    refresh_token: "e2e-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600,
    user: { id, aud: "authenticated", role: "authenticated", email: "e2e-member@example.invalid", is_anonymous: false, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-11T00:00:00Z" },
  };
}

const ROWS = [
  { id: PRODUCT_ID, name: "E2E saved studio", brief: "", created_at: "2026-10-12T00:00:00Z", status: "active", studio_version: 3, ai_consent: null },
  { id: CONSENT_ID, name: "E2E consent only", brief: "", created_at: "2026-10-11T00:00:00Z", status: "active", studio_version: 0, ai_consent: { at: "2026-10-11T00:00:00Z", destination: "gemini" } },
  { id: DRAWING_ID, name: "E2E drawing request", brief: "", created_at: "2026-10-10T00:00:00Z", status: "active", studio_version: 0, ai_consent: null },
];

for (const locale of LOCALES) {
  test(`my projects: product cards open the Studio, drawing keeps the page (${locale})`, async ({ page, baseURL }) => {
    await page.context().addCookies([
      { name: STORAGE_KEY, value: `base64-${Buffer.from(JSON.stringify(fakeSession(MEMBER_ID))).toString("base64url")}`, url: baseURL! },
    ]);
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
      } catch {
        /* storage blocked */
      }
    });
    await page.route(
      (u) => u.host === SUPA.host && u.pathname.startsWith("/rest/v1/"),
      (route) => {
        const u = new URL(route.request().url());
        const body = route.request().method() === "GET" && u.pathname.endsWith("/projects") ? JSON.stringify(ROWS) : "[]";
        return route.fulfill({ status: 200, contentType: "application/json", body });
      },
    );

    await page.goto(`/${locale}/projects`);
    await expectLocale(page, locale);
    const href = async (name: string) => page.getByRole("link", { name, exact: true }).getAttribute("href");
    await expect.poll(() => href("E2E saved studio")).toBe(`/${locale}/projects/${PRODUCT_ID}/studio`);
    expect(await href("E2E consent only")).toBe(`/${locale}/projects/${CONSENT_ID}/studio`);
    expect(await href("E2E drawing request")).toBe(`/${locale}/projects/${DRAWING_ID}`);
    await expectNoHorizontalOverflow(page);
  });
}
