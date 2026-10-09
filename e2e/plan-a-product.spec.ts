import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// Path 1 (read-only): home -> "Plan a product" -> /projects/new. We stop BEFORE
// Start: clicking it would mint an anonymous session, insert a project and call
// the AI on the production project (components/projects/new-project-chat.tsx).
// The write guard (fixtures.ts) fails the test if anything tries.
const IDEA = "a soil moisture sensor that waters my plants";

for (const locale of LOCALES) {
  test.describe(`plan a product [${locale}]`, () => {
    test("home CTA opens /projects/new; Start stays disabled until consent AND text", async ({ page }) => {
      await page.goto(`/${locale}`);
      await expectLocale(page, locale);

      const cta = page.locator(`main a[href="/${locale}/projects/new"]`).first();
      await expect(cta).toBeVisible();
      await cta.click();
      await page.waitForURL(`**/${locale}/projects/new`);
      await expectLocale(page, locale);

      // The chat screen: first assistant line, the one-line input, the consent box.
      await expect(page.getByText(msg(locale, "Projects", "chatFirst"))).toBeVisible();
      const consentCopy = msg(locale, "Prototyping", "aiConsentLabel").split("{destination}")[0].trim();
      await expect(page.getByText(consentCopy, { exact: false })).toBeVisible();

      const consent = page.getByRole("checkbox");
      const input = page.getByRole("textbox");
      const start = page.getByRole("button", { name: msg(locale, "Projects", "chatStartButton"), exact: true });
      await expect(consent).toBeVisible();
      await expect(input).toBeVisible();
      await expect(start).toBeVisible();

      // Nothing yet: disabled.
      await expect(start).toBeDisabled();

      // Wait for hydration: the controlled input only keeps text once React is attached.
      await expect(async () => {
        await input.fill(IDEA);
        await expect(input).toHaveValue(IDEA, { timeout: 1000 });
      }).toPass({ timeout: 15_000 });

      // Text but no consent: still disabled.
      await expect(consent).not.toBeChecked();
      await expect(start).toBeDisabled();

      // Consent + text: enabled.
      await expect(async () => {
        await consent.check();
        await expect(start).toBeEnabled({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });

      // Consent but no text: disabled again.
      await input.fill("");
      await expect(start).toBeDisabled();
      await input.fill(IDEA);
      await expect(start).toBeEnabled();

      // STOP: Start is never clicked. Still on /projects/new.
      expect(new URL(page.url()).pathname).toBe(`/${locale}/projects/new`);
      await expectNoHorizontalOverflow(page);
    });

    test("/projects/new has no horizontal overflow", async ({ page }) => {
      await page.goto(`/${locale}/projects/new`);
      await expectLocale(page, locale);
      await expect(page.getByRole("checkbox")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  });
}
