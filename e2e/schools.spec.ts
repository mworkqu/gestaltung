import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// /schools (the teacher's entry point). Read-only: no form is opened or
// submitted, only the CTA hrefs are checked.
for (const locale of LOCALES) {
  test(`schools renders, links to the class page and fits the screen [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/schools`);
    expect(response?.status()).toBe(200);
    await expectLocale(page, locale);

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText(msg(locale, "Schools", "heading"));

    // "Create a class" goes to the (signed-in) class page.
    const primary = page.getByRole("link", { name: msg(locale, "Schools", "ctaPrimary") });
    await expect(primary.first()).toHaveAttribute("href", `/${locale}/schools/classes`);
    expect(await primary.count()).toBeGreaterThanOrEqual(1);

    // "Talk to us" goes to the contact form with the school kind.
    const talk = page.getByRole("link", { name: msg(locale, "Schools", "ctaSecondary") });
    await expect(talk.first()).toHaveAttribute("href", new RegExp(`/${locale}/contact\\?.*kind=school`));

    // The safety section is named on the page.
    await expect(page.getByText(msg(locale, "Schools", "safetyHeading"), { exact: true }).first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });
}
