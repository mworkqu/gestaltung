import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// W2 (2026-10-11): "Get it made" — one bar from the Enclosure step onward, a real
// pop-up that refuses junk WhatsApp numbers, and the "Request received" quote page.
//
// Runs on the TEST-ONLY Studio fixture (/{locale}/e2e-fixtures/studio, mock
// StudioApi: nothing is written anywhere; the mock's requestQuote applies the same
// phone rule as /api/store-lead and keeps the request on window for this test).
// ?store=1 keeps the doc in this tab, so the guest trip to sign-in comes back to it.
// The quote page for the fixture is /{locale}/e2e-fixtures/studio-request (same
// component as /projects/[id]/request, canned doc).
// Viewports: the "mobile-375" project, and 1366 × 900 on the desktop project.

const IDEA: Record<Loc, string> = {
  en: "A little desk friend that lights up when I walk in",
  ar: "رفيق صغير للمكتب يضيء عندما أدخل",
};
const SHOTS = path.resolve(__dirname, "..", "test-results", "w2-get-it-made");

async function typeWhenHydrated(input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

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

/** Idea → Parts → Wiring → Enclosure on the fixture; returns the shell. */
async function walkToEnclosure(page: Page, locale: Loc, query = "") {
  const res = await page.goto(`/${locale}/e2e-fixtures/studio?store=1${query}`);
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  await expectLocale(page, locale);
  const shell = page.getByTestId("studio-shell");
  const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
  await typeWhenHydrated(input, IDEA[locale]);
  await input.press("Enter");
  await page.getByTestId("studio-choices").getByRole("button").first().click();
  await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
  await expect(shell).toHaveAttribute("data-step", "parts");
  // Not before the Enclosure step.
  await expect(page.getByTestId("studio-get-it-made-bar")).toHaveCount(0);
  await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
  await expect(shell).toHaveAttribute("data-step", "wiring");
  await expect(page.getByTestId("studio-get-it-made-bar")).toHaveCount(0);
  await page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") }).click();
  await expect(page.getByTestId("studio-schematic").locator("svg").first()).toBeVisible();
  await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
  await expect(shell).toHaveAttribute("data-step", "enclosure");
  return shell;
}

async function shot(page: Page, project: string, locale: Loc, name: string) {
  const dir = path.join(SHOTS, `${project}-${locale}`);
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

for (const locale of LOCALES) {
  test(`get it made: junk phones refused, request lands on the quote page [${locale}]`, async ({ page }, info) => {
    test.setTimeout(150_000);
    await setUp(page, info.project.name === "desktop");
    await walkToEnclosure(page, locale);

    // One bar, one button; the old step buttons are gone.
    const bar = page.getByTestId("studio-get-it-made-bar");
    await expect(bar).toBeVisible();
    const open = bar.getByRole("button", { name: msg(locale, "Studio", "getMade") });
    await expect(open).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, info.project.name, locale, "1-enclosure-bar");

    // Pop-up: a real modal dialog; Escape closes it and focus goes back to the button.
    await open.click();
    const dialog = page.getByRole("dialog", { name: msg(locale, "Studio", "getMade") });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(msg(locale, "StudioRequest", "phoneLabel"))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await expect(dialog).toBeVisible();
    // Only what we don't know is asked: the email comes from the account.
    await expect(dialog.getByTestId("studio-get-it-made-known")).toContainText("maker@example.com");
    await expect(dialog.getByLabel(msg(locale, "StudioRequest", "emailLabel"))).toHaveCount(0);
    const name = dialog.getByLabel(msg(locale, "StudioRequest", "nameLabel"));
    const phone = dialog.getByLabel(msg(locale, "StudioRequest", "phoneLabel"));
    const send = dialog.getByRole("button", { name: msg(locale, "StudioRequest", "send") });
    await name.fill("Maryam");
    for (const junk of ["00000000", "11111111", "12345678"]) {
      await phone.fill(junk);
      await send.click();
      await expect(dialog.getByRole("alert")).toContainText(msg(locale, "StudioRequest", "phoneInvalid"));
      await expect(dialog).toBeVisible();
      await expect(page).toHaveURL(/e2e-fixtures\/studio\?/);
    }
    expect(await page.evaluate(() => (window as unknown as { __g360LastQuote?: unknown }).__g360LastQuote ?? null)).toBeNull();
    await shot(page, info.project.name, locale, "2-phone-refused");

    await phone.fill("+974 5555 1234");
    await dialog.getByLabel(msg(locale, "StudioRequest", "noteLabel")).fill("Matte black if possible");
    await send.click();

    // Lands on the quote page.
    await expect(page).toHaveURL(new RegExp(`/${locale}/e2e-fixtures/studio-request$`), { timeout: 20_000 });
    const quote = page.getByTestId("studio-request-page");
    await expect(quote.getByRole("heading", { level: 1 })).toHaveText(msg(locale, "Studio", "requestReceived"));
    await expect(page.getByTestId("studio-request-whatsapp")).toHaveText(msg(locale, "Studio", "requestReceivedText"));
    await expect(page.getByTestId("studio-request-name")).toHaveText(locale === "ar" ? "رفيق المكتب" : "Desk buddy");
    await expect(page.getByTestId("studio-request-picture")).toBeVisible();
    expect(await page.getByTestId("studio-request-parts").locator("li").count()).toBeGreaterThanOrEqual(3);
    expect(await page.getByTestId("studio-request-printed").locator("li").count()).toBeGreaterThanOrEqual(2);
    const estimate = page.getByTestId("studio-request-estimate");
    await expect(estimate).toContainText(msg(locale, "StudioRequest", "estimateLabel"));
    await expect(estimate).toContainText(/800/);
    await expect(estimate).toContainText(/1[,٬]?200/);
    await expect(quote.getByRole("link", { name: msg(locale, "StudioRequest", "myProjects") })).toHaveAttribute("href", `/${locale}/projects`);
    await expectNoHorizontalOverflow(page);
    await shot(page, info.project.name, locale, "3-quote-page");
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await shot(page, info.project.name, locale, "3b-quote-page-bottom");
  });

  test(`get it made: a guest signs up first and comes back to the pop-up [${locale}]`, async ({ page }, info) => {
    test.setTimeout(150_000);
    await setUp(page, info.project.name === "desktop");
    await walkToEnclosure(page, locale, "&who=guest");

    await page.getByTestId("studio-get-it-made-bar").getByRole("button", { name: msg(locale, "Studio", "getMade") }).click();
    const dialog = page.getByRole("dialog", { name: msg(locale, "Studio", "getMade") });
    const guest = dialog.getByTestId("studio-get-it-made-guest");
    await expect(guest).toContainText(msg(locale, "StudioRequest", "guestTitle"));
    await expect(dialog.getByLabel(msg(locale, "StudioRequest", "phoneLabel"))).toHaveCount(0);
    await shot(page, info.project.name, locale, "4-guest");

    // The sign-up link brings them back to this step with the pop-up flag.
    await guest.getByRole("link", { name: msg(locale, "StudioRequest", "signUp") }).click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/sign-up\\?next=`));
    const next = new URL(page.url()).searchParams.get("next") ?? "";
    expect(next).toMatch(new RegExp(`^/${locale}/e2e-fixtures/studio\\?`));
    expect(next).toContain("step=enclosure");
    expect(next).toContain("getItMade=1");

    // Coming back (as the sign-up form would): same project, same step, pop-up open again.
    await page.goto(next);
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "enclosure");
    await expect(page.getByRole("dialog", { name: msg(locale, "Studio", "getMade") })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("getItMade")).toBeNull();
  });
}
