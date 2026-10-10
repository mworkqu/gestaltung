import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// /case-studies (P4-04). The first real story (Nori Slider, client approved)
// is published, so the index lists it and is indexable; the unpublished
// example-startup.md stays a 404. If every story is unpublished again, the
// index falls back to the empty state with noindex.
const NORI_TITLE = {
  en: "Nori Slider: a printable replacement for a broken cup-holder cover",
  ar: "Nori Slider: بديل قابل للطباعة لغطاء حامل الأكواب المكسور",
} as const;

for (const locale of LOCALES) {
  test(`case studies index lists the published story and is indexable [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/case-studies`);
    expect(response?.status()).toBe(200);
    await expectLocale(page, locale);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg(locale, "CaseStudies", "heading"));
    await expect(page.getByRole("heading", { level: 2, name: NORI_TITLE[locale] })).toBeVisible();
    await expect(page.locator(`a[href="/${locale}/case-studies/nori-slider"]`).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: msg(locale, "CaseStudies", "emptyHeading") })).toHaveCount(0);

    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test(`the published story renders [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/case-studies/nori-slider`);
    expect(response?.status()).toBe(200);
    await expectLocale(page, locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NORI_TITLE[locale]);
  });

  test(`the unpublished example story is a 404 [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/case-studies/example-startup`);
    expect(response?.status()).toBe(404);
    await expectLocale(page, locale);
  });
}
