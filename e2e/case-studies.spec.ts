import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// /case-studies (P4-04). While no story is published (content/case-studies has
// only the unpublished example-startup.md) the index is an honest empty state,
// noindex, and the example story is a 404. Once the owner publishes a real
// story, this spec's empty-state assertions are replaced by the story list.
for (const locale of LOCALES) {
  test(`case studies index shows the empty state and is noindex [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/case-studies`);
    expect(response?.status()).toBe(200);
    await expectLocale(page, locale);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText(msg(locale, "CaseStudies", "heading"));
    await expect(page.getByRole("heading", { name: msg(locale, "CaseStudies", "emptyHeading") })).toBeVisible();
    await expect(page.getByText(msg(locale, "CaseStudies", "emptyText"))).toBeVisible();

    // Scoped to the empty-state card: the header and footer may carry similar links.
    const card = page.locator("section", { has: page.getByRole("heading", { name: msg(locale, "CaseStudies", "emptyHeading") }) });
    const start = card.getByRole("link", { name: msg(locale, "CaseStudies", "emptyCtaStart") });
    await expect(start).toHaveAttribute("href", `/${locale}/projects/new`);
    const talk = card.getByRole("link", { name: msg(locale, "CaseStudies", "emptyCtaContact") });
    await expect(talk).toHaveAttribute("href", `/${locale}/contact`);

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expectNoHorizontalOverflow(page);
  });

  test(`the unpublished example story is a 404 [${locale}]`, async ({ page }) => {
    const response = await page.goto(`/${locale}/case-studies/example-startup`);
    expect(response?.status()).toBe(404);
    await expectLocale(page, locale);
  });
}
