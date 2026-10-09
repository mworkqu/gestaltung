import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// /partners/schools and /partners/accelerators (P4-06). Read-only: the contact
// form is never opened or submitted, only the CTA's href is checked.
const PAGES = [
  { slug: "schools", heading: "schoolsHeading", otherTab: "tabAccelerators", otherSlug: "accelerators" },
  { slug: "accelerators", heading: "acceleratorsHeading", otherTab: "tabSchools", otherSlug: "schools" },
] as const;

for (const locale of LOCALES) {
  for (const p of PAGES) {
    test(`partners/${p.slug} renders, links to the contact form and fits the screen [${locale}]`, async ({ page }) => {
      const response = await page.goto(`/${locale}/partners/${p.slug}`);
      expect(response?.status()).toBe(200);
      await expectLocale(page, locale);

      const h1 = page.getByRole("heading", { level: 1 });
      await expect(h1).toBeVisible();
      await expect(h1).toHaveText(msg(locale, "Partners", p.heading));

      // Every contact CTA goes to /contact?kind=partner (hero and closing band).
      const ctas = page.getByRole("link", { name: msg(locale, "Partners", "ctaTalk") });
      await expect(ctas.first()).toHaveAttribute("href", new RegExp(`/${locale}/contact\\?kind=partner$`));
      expect(await ctas.count()).toBeGreaterThanOrEqual(1);

      // The switcher links to the other audience.
      const tabs = page.getByRole("navigation", { name: msg(locale, "Partners", "tabsAria") });
      await expect(tabs.getByRole("link", { name: msg(locale, "Partners", p.otherTab) })).toHaveAttribute(
        "href",
        `/${locale}/partners/${p.otherSlug}`,
      );

      await expectNoHorizontalOverflow(page);
    });
  }
}
