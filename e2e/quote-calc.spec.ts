import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// W2b (2026-10-11): "How we calculated" + "Your quote (QAR)" + "Quote accuracy"
// on the TEST-ONLY route /{locale}/e2e-fixtures/quote-calc (static sample data,
// no Supabase, no session; the real /dashboard/leads/<id> needs a super_admin
// session). Save buttons call no-write fixture server actions. The client side
// ("Your quote: QAR X" instead of the range) uses /e2e-fixtures/studio-request?quoted=1.
//
// Sample: ESP32 at QAR 45 (store) + an LED we source; printed 30 + 20 + 2 g.
//   printing = 100 + 52 × 0.7 = 136.4; subtotal = 181.4 → QAR 180 – 300, middle 240.

const SHOTS = path.resolve(__dirname, "..", "test-results", "w2b-quote-calc");

async function setUp(page: Page, wide: boolean) {
  if (wide) await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
}

async function shot(page: Page, project: string, locale: Loc, name: string) {
  const dir = path.join(SHOTS, `${project}-${locale}`);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
}

for (const locale of LOCALES) {
  test(`admin sees how the estimate was calculated and saves a quote [${locale}]`, async ({ page }, info) => {
    await setUp(page, info.project.name === "desktop");
    const res = await page.goto(`/${locale}/e2e-fixtures/quote-calc`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, locale);

    const card = page.getByTestId("quote-calc-card");
    await expect(card.getByRole("heading", { level: 2, name: msg(locale, "LeadQuote", "calcTitle") })).toBeVisible();
    await expect(card.getByTestId("quote-calc-printed").locator("tbody tr")).toHaveCount(3);
    await expect(card.getByTestId("quote-calc-components").locator("tbody tr")).toHaveCount(2);
    await expect(card.getByTestId("quote-calc-components")).toContainText("SAMPLE-ESP32");
    await expect(card.getByTestId("quote-calc-components")).toContainText(msg(locale, "LeadQuote", "weSource"));
    await expect(card.getByTestId("quote-calc-print")).toContainText("136.4");
    await expect(card.getByTestId("quote-calc-subtotal")).toContainText("181.4");
    await expect(card.getByTestId("quote-calc-range")).toContainText("180");
    await expect(card.getByTestId("quote-calc-range")).toContainText("300");

    // The difference updates as the owner types (middle of the range = 240).
    const form = page.getByTestId("quote-form");
    const input = form.getByLabel(msg(locale, "LeadQuote", "formTitle"));
    await expect(async () => {
      await input.fill("288");
      await expect(page.getByTestId("quote-diff")).toContainText("48", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByTestId("quote-diff")).toContainText("20");

    // Junk is refused, a real number saves (no-write fixture action).
    await input.fill("abc");
    await form.getByRole("button", { name: msg(locale, "LeadQuote", "save") }).click();
    await expect(page.getByTestId("quote-form-status")).toHaveText(msg(locale, "LeadQuote", "err_invalid"));
    await input.fill("288");
    await form.getByLabel(msg(locale, "LeadQuote", "noteLabel")).fill(locale === "ar" ? "يشمل الطلاء" : "Includes painting");
    await form.getByRole("button", { name: msg(locale, "LeadQuote", "save") }).click();
    await expect(page.getByTestId("quote-form-status")).toContainText("288");

    // Quote accuracy: sample quotes 280 / 290 / 270 against a middle of 240
    // (16.7 % above) → the rate that centres the range = (224+232+216 − 3×145) / 156 g = QAR 1.52.
    const acc = page.getByTestId("quote-accuracy");
    await expect(acc.getByRole("heading", { level: 2, name: msg(locale, "LeadQuote", "accTitle") })).toBeVisible();
    await expect(acc.getByTestId("quote-accuracy-suggestion")).toContainText("16.7");
    await expect(acc.getByTestId("quote-accuracy-suggestion")).toContainText("1.52");
    const rate = acc.getByLabel(msg(locale, "LeadQuote", "ruleRate"));
    await expect(rate).toHaveValue("0.7");
    await acc.getByRole("button", { name: /1\.52/ }).click();
    await expect(rate).toHaveValue("1.52");
    await acc.getByRole("button", { name: msg(locale, "LeadQuote", "ruleSave") }).click();
    await expect(acc.getByRole("status")).toHaveText(msg(locale, "LeadQuote", "ruleSaved"));

    await expectNoHorizontalOverflow(page);
    await shot(page, info.project.name, locale, "1-admin-card");
  });

  test(`before 0072: the admin says to run the migration [${locale}]`, async ({ page }, info) => {
    await setUp(page, info.project.name === "desktop");
    await page.goto(`/${locale}/e2e-fixtures/quote-calc?migrated=0`);
    await expect(page.getByTestId("quote-accuracy-migration")).toHaveText(msg(locale, "LeadQuote", "runMigration"));
    await expect(page.getByTestId("quote-calc-card")).toHaveCount(0);
    await expect(page.getByTestId("quote-rule-form")).toBeVisible();
  });

  test(`client sees the owner's quote instead of the range [${locale}]`, async ({ page }, info) => {
    await setUp(page, info.project.name === "desktop");
    await page.goto(`/${locale}/e2e-fixtures/studio-request?quoted=1`);
    const quote = page.getByTestId("studio-request-quote");
    await expect(quote.getByRole("heading", { level: 2, name: msg(locale, "StudioRequest", "quoteTitle") })).toBeVisible();
    await expect(quote).toContainText("450");
    await expect(page.getByTestId("studio-request-quote-note")).toBeVisible();
    await expect(page.getByTestId("studio-request-estimate")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await shot(page, info.project.name, locale, "2-client-quote");

    // Not quoted yet → the estimate range as before.
    await page.goto(`/${locale}/e2e-fixtures/studio-request`);
    await expect(page.getByTestId("studio-request-estimate")).toBeVisible();
    await expect(page.getByTestId("studio-request-quote")).toHaveCount(0);
  });
}
