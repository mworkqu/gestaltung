import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, test } from "./fixtures";

// Path 5 (read-only half): /orders without a session redirects to sign-in
// (app/[locale]/orders/page.tsx). The signed-in view needs a real test account
// and is a manual pass (docs/CUTOVER.md).
for (const locale of LOCALES) {
  test(`orders without a session goes to sign-in [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/orders`);
    await page.waitForURL("**/sign-in**");
    expect(page.url()).toContain("/sign-in");
    expect(new URL(page.url()).pathname.startsWith(`/${locale}/`)).toBe(true);
    await expectLocale(page, locale);
    await expect(page.locator("form").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
