import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// Chat-plugin sign-in (Phase 4a): the consent page's two reachable states for a
// signed-out visitor, and the RFC 9728 metadata document the MCP hosts read.
//
// Nothing here writes, and nothing here needs the OAuth server to be switched
// on in Supabase: a visitor with no session never gets as far as an
// authorization lookup. The approve / deny path needs a real session and a real
// authorization_id, so it is not covered here.

const WIDTHS = [375, 1366];

for (const locale of LOCALES) {
  test(`consent page asks a signed-out visitor to sign in (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/oauth/consent?authorization_id=abcdefgh1234`);

    const card = page.getByTestId("consent-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText(msg(locale, "OauthConsent", "signInTitle"));

    // The sign-in link must come back here with the authorization id intact,
    // or the person loses the request and has to start again in the chat.
    const link = page.getByTestId("consent-sign-in");
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toContain(`/${locale}/sign-in`);
    expect(decodeURIComponent(href ?? "")).toContain("authorization_id=abcdefgh1234");

    await expectLocale(page, locale);
  });

  test(`consent page refuses a link with no authorization id (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/oauth/consent`);

    const card = page.getByTestId("consent-card");
    await expect(card).toContainText(msg(locale, "OauthConsent", "badRequestTitle"));
    await expect(card.locator('[data-state="bad_request"]')).toBeVisible();
    // No sign-in button on a request we cannot complete anyway.
    await expect(page.getByTestId("consent-sign-in")).toHaveCount(0);
  });

  for (const width of WIDTHS) {
    test(`consent card fits ${width}px (${locale})`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/oauth/consent?authorization_id=abcdefgh1234`);
      await expect(page.getByTestId("consent-card")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }
}

test("publishes the protected-resource metadata both MCP hosts look for", async ({ request }) => {
  for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"]) {
    const res = await request.get(path);
    // 404 is the honest answer when Supabase is not configured for this run;
    // anything else (500, a locale redirect, HTML) would be a bug.
    expect([200, 404]).toContain(res.status());
    if (res.status() === 404) continue;

    const body = (await res.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      bearer_methods_supported: string[];
    };
    expect(body.resource).toMatch(/\/api\/mcp$/);
    expect(body.authorization_servers[0]).toMatch(/\/auth\/v1$/);
    expect(body.scopes_supported).toEqual(expect.arrayContaining(["cart:write", "project:write", "meetings:write"]));
    expect(body.bearer_methods_supported).toEqual(["header"]);
    // A browser-based client reads this cross-origin.
    expect(res.headers()["access-control-allow-origin"]).toBe("*");
  }
});

test("an unusable bearer token is refused, not quietly treated as anonymous", async ({ request }) => {
  const body = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  const anonymous = await request.post("/api/mcp", {
    data: body,
    headers: { accept: "application/json, text/event-stream" },
  });
  // Everything from Phases 1-3 still works with no account at all.
  expect(anonymous.status()).toBe(200);

  const bad = await request.post("/api/mcp", {
    data: body,
    headers: { accept: "application/json, text/event-stream", authorization: "Bearer not-a-real-token" },
  });
  expect(bad.status()).toBe(401);
  const challenge = bad.headers()["www-authenticate"] ?? "";
  expect(challenge).toContain('error="invalid_token"');
  expect(challenge).toContain("resource_metadata=");
});
