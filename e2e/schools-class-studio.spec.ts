import type { Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// 3c / 3d (school classes): what a TEAM sees in the Studio.
//
// A class team is 12–15 years old and has no account, so their project must
// never ask for a name, a phone number or an email, never offer checkout, and
// must carry the "12+ with adult supervision" line on every step. The "Get it
// made" bar is replaced by "Ask your teacher to order the parts".
//
// Runs on the TEST-ONLY Studio fixture (/{locale}/e2e-fixtures/studio with
// ?class=1, a mock StudioApi): nothing is written anywhere, and the auto write
// guard in ./fixtures fails the test if anything tries.
//
// The safe-parts rule itself is covered where it is enforced:
// lib/studio/library/class-safe.test.ts pins the exact refused set and
// lib/schools/safe-parts.test.ts covers the server guard the Studio routes use.

async function setUp(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
}

/** Every field on the page, by what it asks for. */
async function fieldKinds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("input, textarea")].map(
      (el) =>
        `${el.getAttribute("type") ?? "text"} ${el.getAttribute("name") ?? ""} ${el.getAttribute("placeholder") ?? ""} ${
          el.getAttribute("aria-label") ?? ""
        }`.toLowerCase(),
    ),
  );
}

for (const locale of LOCALES) {
  test(`a class team's project carries the safety line and never asks for personal data [${locale}]`, async ({
    page,
  }) => {
    await setUp(page);
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?class=1`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, locale);

    const banner = page.getByText(msg(locale, "SchoolSafety", "banner"), { exact: false });
    await expect(banner.first()).toBeVisible();
    await expect(page.getByText(msg(locale, "SchoolSafety", "bannerMore"), { exact: false }).first()).toBeVisible();

    // The Idea step: one text box for the idea, and nothing else.
    const kinds = await fieldKinds(page);
    for (const k of kinds) {
      expect(k, `a field asks for ${k}`).not.toMatch(/email|phone|tel|whatsapp|هاتف|بريد|واتساب/);
    }
    expect(kinds.filter((k) => k.startsWith("email ") || k.startsWith("tel "))).toEqual([]);

    await expectNoHorizontalOverflow(page);
  });

  test(`a class team is sent to its teacher instead of the checkout [${locale}]`, async ({ page }) => {
    await setUp(page);
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?class=1&idea=plant_waterer&finished=1&step=make`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, locale);

    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "make");

    // "Ask your teacher to order the parts" instead of "Order the parts".
    await expect(page.getByTestId("studio-ask-teacher")).toBeVisible();
    await expect(page.getByText(msg(locale, "SchoolSafety", "askTeacherNote"), { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: msg(locale, "Studio", "orderParts") })).toHaveCount(0);

    // W2's "Get it made" bar never appears in a class project.
    await expect(page.getByText(msg(locale, "StudioRequest", "barText"), { exact: false })).toHaveCount(0);

    // The safety line is on this step too, and so is the breadboard wording.
    await expect(page.getByText(msg(locale, "SchoolSafety", "banner"), { exact: false }).first()).toBeVisible();

    await expectNoHorizontalOverflow(page);
  });

  test(`the wiring step tells a class team there is no soldering [${locale}]`, async ({ page }) => {
    await setUp(page);
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?class=1&idea=plant_waterer&step=wiring`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "wiring");
    await expect(page.getByText(msg(locale, "SchoolSafety", "breadboard"), { exact: false })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test(`a normal project is unchanged: no class banner, the checkout is there [${locale}]`, async ({ page }) => {
    await setUp(page);
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?idea=plant_waterer&finished=1&step=make`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expect(page.getByText(msg(locale, "SchoolSafety", "banner"), { exact: false })).toHaveCount(0);
    await expect(page.getByTestId("studio-ask-teacher")).toHaveCount(0);
    await expect(page.getByRole("button", { name: msg(locale, "Studio", "orderParts") })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

// The two entry points a class uses, without creating anything.
for (const locale of LOCALES) {
  test(`the teacher area asks for a sign-in and /join needs no personal data [${locale}]`, async ({ page }) => {
    await setUp(page);
    const res = await page.goto(`/${locale}/schools/classes`);
    expect(res?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe(`/${locale}/sign-in`);

    const join = await page.goto(`/${locale}/join`);
    expect(join?.status()).toBe(200);
    const kinds = await fieldKinds(page);
    for (const k of kinds) {
      expect(k, `a field asks for ${k}`).not.toMatch(/email|phone|tel|whatsapp|هاتف|بريد|واتساب/);
    }
    await expectNoHorizontalOverflow(page);
  });
}
