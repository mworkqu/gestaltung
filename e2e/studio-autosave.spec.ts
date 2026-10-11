import type { Page } from "@playwright/test";

import { emptyStudioDoc } from "../lib/studio/schema";
import { expect, expectLocale, LOCALES, msg, test, type Loc } from "./fixtures";

// D4 — "Did I lose my project?": every step change is saved, and the header says so.
// Runs on the TEST-ONLY studio fixture (/{locale}/e2e-fixtures/studio?store=1,
// E2E_FIXTURES=1). In ?store=1 mode the fixture's StudioApi stands in for
// PUT /api/studio/doc: save() writes the doc to this tab's sessionStorage, so the
// attempt is observable without a database. The suite's write guard blocks every real
// write to production, so we assert the save was ATTEMPTED (the stored doc follows the
// step) rather than that a row changed.

const STORE_KEY = "g360:e2e-studio-doc";

async function storedStep(page: Page): Promise<string | null> {
  return page.evaluate((key) => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? ((JSON.parse(raw) as { doc?: { lastStep?: string } }).doc?.lastStep ?? null) : null;
    } catch {
      return null;
    }
  }, STORE_KEY);
}

for (const locale of LOCALES) {
  test(`studio saves on every step change and shows the status [${locale}]`, async ({ page }) => {
    const loc: Loc = locale;
    const doc = {
      ...emptyStudioDoc(),
      components: [{ partId: "esp32_devkit", instanceId: "esp32_devkit_1", label: "ESP32" }],
    };
    await page.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
          if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, value);
        } catch {
          /* storage blocked */
        }
      },
      [STORE_KEY, JSON.stringify({ doc, version: 1 })],
    );
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?store=1`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, loc);

    const status = page.getByTestId("studio-save-status");
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("aria-live", "polite");
    await expect(status).toHaveAttribute("data-status", "saved");
    await expect(status).toContainText(msg(loc, "Studio", "saveSaved"));

    // Walk the reachable steps back and forth: each move must be saved.
    const stepButton = (id: string) => page.getByRole("button", { name: msg(loc, "Studio", `step_${id}`) });
    for (const id of ["parts", "idea", "wiring"]) {
      await stepButton(id).click();
      await expect.poll(() => storedStep(page), { message: `saved after moving to ${id}` }).toBe(id);
      await expect(status).toHaveAttribute("data-status", "saved");
    }
  });
}
