import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// /join (3c). Read-only: the form is never submitted with a valid code, so no
// anonymous session is created. The invalid-code case must send nothing at all
// (the fixture's write guard fails the test otherwise).
for (const locale of LOCALES) {
  test(`join renders, collects nothing personal and fits the screen [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/join`);
    expect(response?.status()).toBe(200);
    await expectLocale(page, locale);

    const h1 = page.getByRole("heading", { level: 1 });
    await expect(h1).toBeVisible();
    await expect(h1).toHaveText(msg(locale, "SchoolJoin", "heading"));

    await expect(page.getByLabel(msg(locale, "SchoolJoin", "codeLabel"))).toBeVisible();
    await expect(page.getByLabel(msg(locale, "SchoolJoin", "teamLabel"))).toBeVisible();
    await expect(page.getByText(msg(locale, "SchoolJoin", "privacy"))).toBeVisible();
    await expect(page.getByText(msg(locale, "SchoolSafety", "banner"))).toBeVisible();
    await expect(page.getByRole("link", { name: msg(locale, "SchoolJoin", "teacherLink") })).toHaveAttribute(
      "href",
      `/${locale}/schools`,
    );

    // Nothing personal is collected.
    await expect(page.locator('input[type="email"], input[type="tel"]')).toHaveCount(0);
    await expect(page.getByLabel(/email|phone|البريد|هاتف/i)).toHaveCount(0);

    await expectNoHorizontalOverflow(page);
  });

  test(`join prefills the code from the link [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/join?code=bk7tq2`);
    await expect(page.getByLabel(msg(locale, "SchoolJoin", "codeLabel"))).toHaveValue("BK7TQ2");
  });

  test(`join rejects a badly shaped code without a request [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/join`);
    await page.getByLabel(msg(locale, "SchoolJoin", "codeLabel")).fill("BK7TQ");
    await page.getByLabel(msg(locale, "SchoolJoin", "teamLabel")).fill("Falcon");
    await page.getByRole("button", { name: msg(locale, "SchoolJoin", "join") }).click();
    await expect(page.getByText(msg(locale, "SchoolJoin", "errCode"))).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
