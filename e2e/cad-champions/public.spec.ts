import { cc, expect, layoutOk, LOCALES, openPublic, test } from "./cc";

// The REAL public CC pages (read-only): landing + FAQ accordion, Help Center
// search form (inspected, never submitted: a submitted search is logged
// server-side), and sign-up validation (minor -> guardian block; the form is
// submitted only empty/incomplete so the client check stops it before any
// action — the action guard in cc.ts would fail the test otherwise).

function yearsAgo(years: number): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
}

for (const locale of LOCALES) {
  test.describe(`public pages (${locale})`, () => {
    test("landing: hero, FAQ accordion opens and closes", async ({ page }) => {
      await openPublic(page, locale, "");
      await expect(page.locator("#cc-hero-title")).toBeVisible();
      await expect(page.getByRole("heading", { name: cc(locale, "landing", "faq.title") })).toBeVisible();
      await layoutOk(page);

      const question = page.locator('section[aria-labelledby="cc-faq"] button[aria-expanded]').first();
      await question.scrollIntoViewIfNeeded();
      await expect(question).toHaveAttribute("aria-expanded", "false");
      const panel = page.locator(`#${await question.getAttribute("aria-controls")}`);
      await expect(panel).toBeHidden();
      await question.click();
      await expect(question).toHaveAttribute("aria-expanded", "true");
      await expect(panel).toBeVisible();
      await question.click();
      await expect(question).toHaveAttribute("aria-expanded", "false");
      await layoutOk(page);
    });

    test("help center: search form is a plain GET to /help?q=", async ({ page }) => {
      await openPublic(page, locale, "/help");
      const form = page.getByRole("search");
      await expect(form).toBeVisible();
      await expect(form).toHaveAttribute("method", "get");
      await expect(form).toHaveAttribute("action", `/cad-champions/${locale}/help`);
      const input = form.getByLabel(cc(locale, "help", "searchLabel"));
      await expect(input).toHaveAttribute("name", "q");
      await input.fill("STEP export");
      await expect(form.getByRole("button", { name: cc(locale, "help", "searchButton") })).toBeEnabled();
      await layoutOk(page);
    });

    test("sign up: under-18 date of birth asks for a guardian; incomplete form never submits", async ({ page, actions }) => {
      await openPublic(page, locale, "/sign-up");
      const dob = page.locator("#cc-dateOfBirth");
      await expect(dob).toBeVisible();
      await expect(page.locator("#cc-guardianName")).toHaveCount(0);

      await dob.fill(yearsAgo(15));
      await expect(page.getByText(cc(locale, "auth", "signUp.minorTitle")).first()).toBeVisible();
      await expect(page.locator("#cc-guardianName")).toBeVisible();
      await expect(page.locator("#cc-guardianConsent")).toBeVisible();
      await layoutOk(page);

      await page.getByRole("button", { name: cc(locale, "auth", "signUp.submit") }).click();
      await expect(page.getByText(cc(locale, "auth", "errors.guardianName")).first()).toBeVisible();
      await expect(page.getByText(cc(locale, "auth", "signUp.fixErrors")).first()).toBeVisible();

      await dob.fill(yearsAgo(20));
      await expect(page.locator("#cc-guardianName")).toHaveCount(0);
      expect(actions.calls).toHaveLength(0);
      await layoutOk(page);
    });
  });
}
