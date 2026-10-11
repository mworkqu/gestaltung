import { expect, expectLocale, LOCALES, test } from "./fixtures";

// Social sign-in buttons show ONLY for providers enabled in Supabase
// (GET /auth/v1/settings → external.google / apple / azure). Today only email +
// anonymous are on, so /sign-in and /sign-up must look exactly as before: no
// buttons, no "or" divider. When the owner enables a provider this spec fails
// on purpose — update it then. Read-only: nothing is clicked.
for (const locale of LOCALES) {
  for (const page_ of ["sign-in", "sign-up"] as const) {
    test(`no social buttons while providers are off [${locale} ${page_}]`, async ({ page }) => {
      await page.goto(`/${locale}/${page_}`);
      await expectLocale(page, locale);
      await expect(page.locator("form").first()).toBeVisible();
      await expect(page.locator('[data-testid^="oauth-"]')).toHaveCount(0);
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
