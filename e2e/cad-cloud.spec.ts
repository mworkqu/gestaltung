import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// The cloud CAD result card (components/credits/cad-cloud-result.tsx) with a
// stored cloud result, rendered in isolation on the TEST-ONLY route
// /{locale}/e2e-fixtures/cad-cloud (lib/e2e-fixtures.ts: needs E2E_FIXTURES=1
// on the server, which playwright.config.ts sets; never reachable on Vercel).
// No session, no Supabase, no write.

for (const locale of LOCALES) {
  test(`cloud CAD card shows the two downloads [${locale}]`, async ({ page }) => {
    const res = await page.goto(`/${locale}/e2e-fixtures/cad-cloud`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1 (playwright.config.ts webServer.env)").toBe(200);
    await expectLocale(page, locale);

    const card = page.getByTestId("cad-cloud-result");
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: msg(locale, "Credits", "cadDownloadStlPrint") })).toBeVisible();
    await expect(card.getByRole("button", { name: msg(locale, "Credits", "cadDownloadStep") })).toBeVisible();
    await expect(card.getByRole("link", { name: msg(locale, "Credits", "cadGetMade") })).toBeVisible();
    await expect(card.getByRole("img", { name: msg(locale, "Credits", "cadCloudPreviewAlt") })).toBeVisible();
    // Client view: no code, no log, no check names.
    await expect(page.getByTestId("cad-engineer")).toHaveCount(0);
    await expect(card).not.toContainText("must_contain_box");
    await expectNoHorizontalOverflow(page);
  });
}
