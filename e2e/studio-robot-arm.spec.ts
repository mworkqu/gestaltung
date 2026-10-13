import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// Part F — the incident chat, end to end on the TEST-ONLY studio fixture
// (/{locale}/e2e-fixtures/studio, E2E_FIXTURES=1; mocked StudioApi, no AI, no write).
// From the Idea step, "big robotic arm like ur10" → a reply about the desktop version,
// a card with the scale note and "6 joints", then Parts = board + PCA9685 servo driver +
// MG996R × 3 + SG90 × 3 + the 5 V 5 A supply (grouped), wiring that passes our checks and a
// pin list with 6 servo rows. EN + AR, 375 px (mobile-375 project) and 1366 px.
// The mock answers the arm with lib/studio/__fixtures__/robot-arm.ts robotArmSpec() and picks
// through the server's own enforcePick, so this is the same arm as ?idea=robot_arm (Part E).

const IDEA: Record<Loc, string> = { en: "big robotic arm like ur10", ar: "ذراع روبوت كبيرة مثل UR10" };
const DESKTOP_WORD: Record<Loc, RegExp> = { en: /desktop/i, ar: /مكتبية/ };
const SCALE_WORD: Record<Loc, RegExp> = { en: /UR10.*desktop/i, ar: /UR10.*مكتبية/ };
const JOINTS_LINE: Record<Loc, string> = { en: "6 joints · servo motors", ar: "6 مفاصل · محركات سيرفو" };

/** Library part → how many the Parts step must show (one grouped row each). */
const PARTS: Record<string, number> = { esp32_devkit: 1, pca9685_servo: 1, mg996r_servo: 3, sg90_servo: 3, psu_5v_5a: 1 };

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
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "idea");
}

async function typeWhenHydrated(input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

/** Main button "Draw my wiring" (credit or free label), when the step has not drawn yet. */
async function draw(page: Page, locale: Loc) {
  const credit = page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") });
  const free = page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawFree") });
  const tabs = page.getByTestId("studio-wiring-tabs");
  await expect(credit.or(free).or(tabs).first()).toBeVisible({ timeout: 20_000 });
  if (!(await tabs.isVisible())) await ((await credit.isVisible()) ? credit : free).click();
  await expect(tabs).toBeVisible({ timeout: 20_000 });
}

for (const locale of LOCALES) {
  test(`robot arm from the chat: desktop reply, 6 joints, grouped parts, wiring passes, 6 servo rows [${locale}]`, async ({ page }, info) => {
    test.setTimeout(180_000);
    if (info.project.name !== "mobile-375") await page.setViewportSize({ width: 1366, height: 900 });
    await open(page, locale);
    const shell = page.getByTestId("studio-shell");

    // ── Idea: the reply says what we can build; the card carries the scale note + 6 joints ──
    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await typeWhenHydrated(input, IDEA[locale]);
    await input.press("Enter");
    const card = page.getByTestId("studio-idea-summary");
    await expect(card).toHaveAttribute("data-state", "spec", { timeout: 20_000 });
    await expect(page.getByTestId("studio-idea-reply").last()).toContainText(DESKTOP_WORD[locale]);
    await expect(page.getByTestId("studio-idea-scale")).toHaveText(SCALE_WORD[locale]);
    await expect(page.getByTestId("studio-idea-actuator-line")).toHaveText(JOINTS_LINE[locale]);
    await expect(page.getByTestId("studio-idea-updated")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    // ── Parts: board + servo driver + 3 MG996R + 3 SG90 + 5 A supply, identical parts grouped ──
    await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
    await expect(shell).toHaveAttribute("data-step", "parts");
    const rows = page.getByTestId("studio-part-row");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    await expect(rows).toHaveCount(Object.keys(PARTS).length);
    for (const [partId, n] of Object.entries(PARTS)) {
      const row = page.locator(`[data-testid="studio-part-row"][data-part="${partId}"]`);
      await expect(row, partId).toHaveCount(1);
      await expect(row, partId).toHaveAttribute("data-quantity", String(n));
      if (n > 1) await expect(row.getByTestId("studio-part-name"), partId).toContainText(`× ${n}`);
    }
    await expectNoHorizontalOverflow(page);

    // ── Wiring: drawn, every plain check passes, the pin list has one row per servo channel ──
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "wiring");
    await draw(page, locale);
    await expect(page.getByText(msg(locale, "Studio", "checksHeading"))).toBeVisible();
    await expect(page.getByText(msg(locale, "Studio", "checkOkSr"), { exact: true }).first()).toBeAttached();
    await expect(page.getByText(msg(locale, "Studio", "checkFixedSr"), { exact: true })).toHaveCount(0);
    await page.getByTestId("studio-wiring-tab-pins").click();
    await expect(page.getByTestId("studio-wiring-panel-pins")).toBeVisible();
    const pins = page.getByTestId("studio-pin-row");
    await expect(pins.first()).toBeVisible();
    await expect(pins.filter({ hasText: /CH[0-5](?!\d)/ })).toHaveCount(6);
    await expectNoHorizontalOverflow(page);
  });
}
