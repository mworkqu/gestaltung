import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// The tier checkpoint on the TEST-ONLY studio fixture (mock StudioApi, no AI, nothing
// written). The mock starts with 10 tokens and answers `needsApproval` for "custom pcb"
// (Makers, 7: affordable) and "turnkey" (Engineers, 14: not affordable). Copy comes from
// Studio.tierAsk_* / tierWhy_* (added by the messages agent).

const PLANT: Record<Loc, string> = {
  en: "automatic small plant watering monitor",
  ar: "جهاز صغير يسقي النبتة تلقائياً",
};
const PCB: Record<Loc, string> = { en: "add a custom pcb", ar: "أضف لوحة مخصصة" };
const TURNKEY: Record<Loc, string> = { en: "make it turnkey", ar: "اجعله جاهز للتسليم" };

async function open(page: Page, locale: Loc) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const res = await page.goto(`/${locale}/e2e-fixtures/studio`);
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  await expectLocale(page, locale);
}

async function typeWhenHydrated(input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** A finished first card, ready to be refined. */
async function withCard(page: Page, locale: Loc) {
  await open(page, locale);
  const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
  await typeWhenHydrated(input, PLANT[locale]);
  await input.press("Enter");
  await page.getByTestId("studio-choices").getByRole("button").first().click();
  await expect(page.getByTestId("studio-idea-summary")).toHaveAttribute("data-state", "spec");
}

for (const locale of LOCALES) {
  test(`tier checkpoint: keep refining spends nothing, the balance never lies [${locale}]`, async ({ page }) => {
    test.setTimeout(90_000);
    await withCard(page, locale);
    const tokens = page.getByTestId("studio-tokens");
    await expect(tokens).toHaveAttribute("data-balance", "10");

    const refine = page.getByTestId("studio-idea-chat").getByRole("textbox").last();
    await typeWhenHydrated(refine, PCB[locale]);
    await refine.press("Enter");

    // F-023: while the turn is in flight the number is the real one, never 0.
    await expect(page.getByTestId("studio-typing")).toBeVisible();
    await expect(tokens).toHaveAttribute("data-balance", "10");

    const ask = page.getByTestId("studio-tier-ask");
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("7");
    await expect(ask.getByTestId("studio-tier-ask-reasons").locator("li")).toHaveCount(2);
    await expect(ask).toContainText(msg(locale, "Studio", "tierAsk_free"));
    await expect(ask.getByTestId("studio-tier-approve")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Escape = keep refining: closed, nothing spent, the previous card stays.
    await page.keyboard.press("Escape");
    await expect(ask).toBeHidden();
    await expect(tokens).toHaveAttribute("data-balance", "10");
    await expect(page.getByTestId("studio-idea-summary")).not.toContainText("Custom PCB");
  });

  test(`tier checkpoint: approve spends exactly the quote and applies the change [${locale}]`, async ({ page }) => {
    test.setTimeout(90_000);
    await withCard(page, locale);
    const refine = page.getByTestId("studio-idea-chat").getByRole("textbox").last();
    await typeWhenHydrated(refine, PCB[locale]);
    await refine.press("Enter");

    const ask = page.getByTestId("studio-tier-ask");
    await expect(ask.getByTestId("studio-tier-approve")).toBeFocused();
    await ask.getByTestId("studio-tier-approve").click();
    await expect(ask).toBeHidden();
    await expect(page.getByTestId("studio-idea-summary")).toContainText("Custom PCB");
    await expect(page.getByTestId("studio-tokens")).toHaveAttribute("data-balance", "3");
  });

  test(`tier checkpoint: not enough tokens has no approve button, 44px targets, focus trapped [${locale}]`, async ({ page }) => {
    test.setTimeout(90_000);
    await withCard(page, locale);
    const refine = page.getByTestId("studio-idea-chat").getByRole("textbox").last();
    await typeWhenHydrated(refine, TURNKEY[locale]);
    await refine.press("Enter");

    const ask = page.getByTestId("studio-tier-ask");
    await expect(ask).toBeVisible();
    await expect(ask).toContainText("14");
    await expect(ask.getByTestId("studio-tier-approve")).toHaveCount(0);
    await expect(ask.getByTestId("studio-tier-ask-short").getByRole("link")).toBeVisible();

    const keep = ask.getByTestId("studio-tier-keep");
    await expect(keep).toBeFocused();
    expect((await keep.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Tab never reaches the page behind. A native modal really does trap focus, but
    // Chromium parks on <body> for one frame as it wraps round the top layer (measured:
    // keep -> body -> "Get tokens" -> keep), and <body> itself holds nothing focusable.
    // So the check is "never an element outside the dialog", not "always inside it" -
    // the stricter wording failed on the wrap frame while the trap was working.
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const at = await page.evaluate(() => {
        const a = document.activeElement;
        return { inDialog: Boolean(a?.closest("dialog")), isBody: a === document.body, text: (a?.textContent ?? "").trim().slice(0, 40) };
      });
      expect(at.inDialog || at.isBody, `Tab escaped to: ${at.text}`).toBe(true);
    }
    await keep.click();
    await expect(ask).toBeHidden();
    await expect(page.getByTestId("studio-tokens")).toHaveAttribute("data-balance", "10");
  });
}
