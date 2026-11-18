import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// The chat-plugin handoff page (/{locale}/handoff/<token>). The states are
// rendered with no network on the TEST-ONLY route /{locale}/e2e-fixtures/handoff
// (lib/e2e-fixtures.ts: needs E2E_FIXTURES=1, never reachable on Vercel). The
// write guard in ./fixtures stays on: nothing here may write.

const WIDTHS = [375, 1366];

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`handoff states [${locale} ${width}px]`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const res = await page.goto(`/${locale}/e2e-fixtures/handoff`);
      expect(res?.status(), "start the server with E2E_FIXTURES=1 (playwright.config.ts webServer.env)").toBe(200);
      await expectLocale(page, locale);

      const state = (s: string) => page.locator(`[data-testid="handoff-card"][data-state="${s}"]`);

      await expect(state("loading")).toContainText(msg(locale, "Handoff", "title"));
      await expect(state("loading")).toContainText(msg(locale, "Handoff", "loading"));
      await expect(state("expired")).toContainText(msg(locale, "Handoff", "expired"));
      await expect(state("limit")).toContainText(msg(locale, "Handoff", "limitText"));
      await expect(state("limit").getByRole("link", { name: msg(locale, "Handoff", "limitLink") })).toBeVisible();
      await expect(state("error")).toContainText(msg(locale, "Handoff", "error"));
      await expect(state("error").getByRole("button", { name: msg(locale, "Handoff", "retry") })).toBeVisible();
      await expect(state("notReady")).toContainText(msg(locale, "Handoff", "notReady"));

      const phone = state("phone");
      await expect(phone).toContainText(msg(locale, "Handoff", "phoneTitle"));
      await expect(phone.getByRole("button", { name: msg(locale, "Handoff", "phoneSave") })).toBeVisible();
      await expect(phone.getByRole("button", { name: msg(locale, "Handoff", "phoneSkip") })).toBeVisible();
      // The fixture's Save handler only flips the invalid flag: Phone.invalid appears.
      await phone.getByRole("button", { name: msg(locale, "Handoff", "phoneSave") }).click();
      await expect(phone).toContainText(msg(locale, "Phone", "invalid"));

      await expectNoHorizontalOverflow(page);
    });

    test(`malformed token shows the expired message, no write [${locale} ${width}px]`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${locale}/handoff/not-a-valid-token!!`);
      await expectLocale(page, locale);
      await expect(page.getByTestId("handoff-expired")).toContainText(msg(locale, "Handoff", "expired"));
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expectNoHorizontalOverflow(page);
      // The `guard` fixture fails the test if anything tried to write.
    });
  }
}
