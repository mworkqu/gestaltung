import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// W4 · Parts step: the part popover (photo or icon, name, purpose, price, stock),
// the stronger selected / hover state. Runs on the mocked Studio fixture
// (no Supabase, no AI). The fixture library has no store SKUs, so the popover
// shows the icon and "We'll source this"; the photo choice and allowed hosts
// are covered by lib/studio/part-photo.test.ts.

const IDEA: Record<(typeof LOCALES)[number], string> = {
  en: "A little desk friend that lights up when I walk in",
  ar: "رفيق صغير للمكتب يضيء عندما أدخل",
};
/** Studio.partsPopover.<key> (fixtures' msg() reads one level only). */
function popoverMsg(locale: (typeof LOCALES)[number], key: string): string {
  const all = JSON.parse(readFileSync(path.resolve(__dirname, "..", "messages", `${locale}.json`), "utf8"));
  return all.Studio.partsPopover[key] as string;
}
const SHOTS = path.resolve(__dirname, "..", "test-results", "w4-parts");

async function toParts(page: Page, locale: (typeof LOCALES)[number]) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const res = await page.goto(`/${locale}/e2e-fixtures/studio`);
  expect(res?.status()).toBe(200);
  const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
  await expect(async () => {
    await input.fill(IDEA[locale]);
    await expect(input).toHaveValue(IDEA[locale], { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await input.press("Enter");
  await page.getByTestId("studio-choices").getByRole("button").first().click();
  await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "parts");
  await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible();
}

for (const locale of LOCALES) {
  test(`parts popover and card states [${locale}]`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await toParts(page, locale);
    const rows = page.getByTestId("studio-part-row");
    const first = rows.first();
    const info1 = first.getByTestId("studio-part-info");
    const pop = (row: Locator) => row.getByRole("group");

    // Closed by default, reachable by keyboard (a real button with a name and state).
    await expect(pop(first)).toHaveCount(0);
    await expect(info1).toHaveAttribute("aria-expanded", "false");

    // Tap / Enter opens it; contents: name, purpose line, stock status, icon (no photo here).
    await info1.focus();
    await page.keyboard.press("Enter");
    await expect(info1).toHaveAttribute("aria-expanded", "true");
    const popover = pop(first);
    await expect(popover).toBeVisible();
    await expect(popover).toContainText(popoverMsg(locale, "sourceNoTime"));
    await expect(popover.locator("svg").first()).toBeVisible();

    // Stays inside the viewport, RTL-safe: no sideways scroll.
    const box = await popover.boundingBox();
    const vw = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vw + 1);
    await expectNoHorizontalOverflow(page);
    if (info.project.name === "mobile-375") {
      mkdirSync(SHOTS, { recursive: true });
      await popover.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `popover-${locale}.png`) });
    }

    // Esc closes it.
    await page.keyboard.press("Escape");
    await expect(pop(first)).toHaveCount(0);

    // Tap opens, a press outside the list closes.
    await info1.click();
    await expect(pop(first)).toBeVisible();
    await page.getByRole("heading", { level: 1 }).first().click({ position: { x: 2, y: 2 }, force: true });
    await expect(pop(first)).toHaveCount(0);

    // Selected: ring + lift (data-selected) on the row; the others stay plain.
    await first.locator("button[aria-pressed]").click();
    await expect(first).toHaveAttribute("data-selected", "true");
    await expect(rows.nth(1)).not.toHaveAttribute("data-selected", "true");
    await expect(first).toHaveClass(/ring-2/);
  });

  test(`parts popover opens on mouse hover [${locale}]`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile-375", "hover is a desktop (mouse) behaviour");
    await toParts(page, locale);
    const first = page.getByTestId("studio-part-row").first();
    await first.hover();
    await expect(first.getByRole("group")).toBeVisible();
    await page.mouse.move(2, 2);
    await expect(first.getByRole("group")).toHaveCount(0);
  });
}
