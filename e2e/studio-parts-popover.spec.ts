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
  await settled(page);
}

/**
 * Wait until the parts list stops being replaced.
 *
 * The rows arrive, then the step settles and the list is rendered again. The
 * popover's open state is held by instanceId (`popFor` in PartsStep), so a
 * popover opened inside that window is dropped when the new list arrives - the
 * row it belonged to is no longer the same row. A person cannot tap within
 * ~200ms of the list appearing, but a test can, and then the popover vanishes
 * mid-assertion ("element is not attached to the DOM").
 *
 * Measured on 2026-10-25: identical on this branch and on origin/main - opening
 * immediately loses the popover on BOTH, and opening on a settled list keeps it
 * on both. So this is the test racing the app, not a change in the app. The
 * product side (keep `popFor` when the instance survives the re-render) is a
 * follow-up in FIX_REPORT, not something to change under a test deadline.
 */
async function settled(page: Page) {
  const list = page.getByTestId("studio-parts-list");
  let last = "";
  await expect(async () => {
    const now = await list.innerHTML();
    const same = now === last;
    last = now;
    expect(same, "the parts list is still being replaced").toBe(true);
  }).toPass({ timeout: 15_000, intervals: [250, 250, 250] });
  // The pointer is still wherever the last click left it, and a row opens its
  // popover on mouse enter. Once we wait for the list to settle, that stale
  // position lands on a row and the popover is open before the test has asked
  // for it - so park the pointer off the rows, which is what "closed by
  // default" assumes.
  await page.mouse.move(0, 0);
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
