import { envVar, expect, expectLocale, LOCALES, msg, test } from "./fixtures";
import { OAUTH_PROVIDERS, PROVIDER_LABEL, parseEnabledProviders, type OAuthProvider } from "../lib/auth/providers";

// Social sign-in buttons show ONLY for providers enabled in Supabase
// (GET /auth/v1/settings → external.google / apple / azure). Google was turned
// on on 18 Oct 2026 (docs/SOCIAL_SIGN_IN.md), so hard-coding "no buttons" is no
// longer true. Instead this spec asks Supabase itself which providers are on —
// the same read the app makes in lib/auth/providers-server.ts — and then
// asserts the pages show EXACTLY those buttons: every enabled provider has one
// with the right label, every disabled one has none, and the "or" divider is
// there only when there is at least one button. So it stays honest whichever
// providers the owner switches on or off later.
//
// Read-only: the settings read is a GET (it passes the write guard) and no
// button is ever clicked — clicking one would leave the site for the provider.

let enabled: Promise<OAuthProvider[]> | null = null;

/** The providers Supabase currently has enabled, read once per worker. */
function enabledProviders(): Promise<OAuthProvider[]> {
  enabled ??= (async () => {
    const url = envVar("NEXT_PUBLIC_SUPABASE_URL");
    const key = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    if (!url || !key) {
      throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing: cannot tell which providers are on");
    }
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: key },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`GET /auth/v1/settings → ${res.status}`);
    return parseEnabledProviders(await res.json());
  })();
  return enabled;
}

for (const locale of LOCALES) {
  for (const page_ of ["sign-in", "sign-up"] as const) {
    test(`social buttons match the enabled providers [${locale} ${page_}]`, async ({ page }) => {
      const providers = await enabledProviders();

      await page.goto(`/${locale}/${page_}`);
      await expectLocale(page, locale);
      await expect(page.locator("form").first()).toBeVisible();

      // Exactly the enabled providers, each with its own labelled button.
      await expect(page.locator('[data-testid^="oauth-"]')).toHaveCount(providers.length);
      for (const provider of OAUTH_PROVIDERS) {
        const button = page.getByTestId(`oauth-${provider}`);
        if (!providers.includes(provider)) {
          await expect(button, `${provider} is off in Supabase: no button`).toHaveCount(0);
          continue;
        }
        await expect(button, `${provider} is on in Supabase: a button`).toBeVisible();
        await expect(button).toHaveText(msg(locale, "Auth", "continueWith").replace("{provider}", PROVIDER_LABEL[provider]));
      }

      // The "or" divider belongs to the buttons: only there when they are.
      if (providers.length > 0) {
        const block = page.locator('[data-testid^="oauth-"]').first().locator("xpath=..");
        await expect(block.getByText(msg(locale, "Auth", "orDivider"), { exact: true })).toBeVisible();
      }
    });
  }

  test(`provider error line on sign-in [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/sign-in?oauth_error=google`);
    await expect(page.getByRole("alert").filter({ hasText: "Google" })).toBeVisible();
    // A value we do not offer shows nothing.
    await page.goto(`/${locale}/sign-in?oauth_error=github`);
    await expect(page.getByRole("alert").filter({ hasText: "github" })).toHaveCount(0);
  });
}
