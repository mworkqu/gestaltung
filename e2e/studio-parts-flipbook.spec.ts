import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, test, type Loc } from "./fixtures";

// Owner 2026-10-12: "spinning the electronics was cool". The Parts step picture is a
// flipbook of small pictures the geometry worker drew (no three.js on the page).
// On the TEST-ONLY Studio fixture (nothing written):
//  * the frames cycle by themselves (img src changes over time);
//  * dragging left / right turns the parts (the frame changes, the spin holds meanwhile);
//  * prefers-reduced-motion: a still frame, dragging still turns it, the tap dots are there;
//  * the tap dots appear while the parts are held still and select a part.
// "No three.js / R3F request before Create my CAD" stays in studio-engine.spec.ts.

const SHOTS = path.resolve(__dirname, "..", "test-results", "flipbook");

async function open(page: Page, locale: Loc) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const res = await page.goto(`/${locale}/e2e-fixtures/studio?product=1&idea=plant_waterer&step=parts`);
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  await expectLocale(page, locale);
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "parts");
}

/** The flipbook once every frame has arrived. */
async function readyFlipbook(page: Page): Promise<Locator> {
  const flip = page.getByTestId("studio-parts-viewer").getByTestId("studio-parts-flipbook");
  await expect(flip).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("studio-parts-viewer").locator('[data-picture="ready"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(flip).not.toHaveAttribute("data-mode", "loading", { timeout: 60_000 });
  return flip;
}

const frameOf = async (flip: Locator) => Number(await flip.getAttribute("data-frame"));
const srcOf = (flip: Locator) => flip.getByTestId("studio-parts-picture").getAttribute("src");

for (const locale of LOCALES) {
  test(`parts flipbook: frames cycle by themselves [${locale}]`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page, locale);
    const flip = await readyFlipbook(page);
    // Keep the mouse away from the picture (hovering holds the spin).
    await page.mouse.move(0, 0);
    await expect(flip).toHaveAttribute("data-mode", "spinning", { timeout: 10_000 });
    const seen = new Set<string | null>();
    for (let i = 0; i < 8; i++) {
      seen.add(await srcOf(flip));
      await page.waitForTimeout(160);
    }
    expect(seen.size, "the img src changes over time").toBeGreaterThan(3);

    // The worker sent a small set (WebP): count and size are on the pane for the report.
    const pane = page.getByTestId("studio-parts-viewer").locator("[data-spin-frames]");
    const frames = Number(await pane.getAttribute("data-spin-frames"));
    const bytes = Number(await pane.getAttribute("data-spin-bytes"));
    expect(frames).toBeGreaterThanOrEqual(20);
    expect(bytes).toBeLessThan(650_000);
    console.log(`[flipbook ${locale} ${info.project.name}] frames=${frames} bytes=${bytes} firstFrameMs=${await pane.getAttribute("data-spin-first-ms")} allFramesMs=${await pane.getAttribute("data-spin-ms")}`);

    await expectNoHorizontalOverflow(page);
    mkdirSync(SHOTS, { recursive: true });
    await page.getByTestId("studio-parts-viewer").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, `spinning-${locale}-${info.project.name}.png`) });
  });

  test(`parts flipbook: dragging turns the parts and dots select [${locale}]`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await open(page, locale);
    const flip = await readyFlipbook(page);
    const box = (await flip.boundingBox())!;
    const y = box.y + box.height * 0.5;

    // Hover holds the spin; a drag to the right moves the frame, a drag back returns it.
    await page.mouse.move(box.x + box.width * 0.3, y);
    await expect(flip).toHaveAttribute("data-mode", "paused");
    const f0 = await frameOf(flip);
    const s0 = await srcOf(flip);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, y, { steps: 8 });
    const f1 = await frameOf(flip);
    expect(f1).not.toBe(f0);
    expect(await srcOf(flip)).not.toBe(s0);
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 8 });
    expect(await frameOf(flip)).toBe(f0);
    await page.mouse.up();

    // While held, the tap dots are there and select a part (its list row too).
    const spots = page.getByTestId("studio-parts-viewer").getByTestId("studio-parts-spot");
    const rows = page.getByTestId("studio-part-row");
    await expect(spots).toHaveCount(await rows.count());
    await spots.first().click();
    await expect(spots.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-testid="studio-part-row"][data-selected="true"]')).toHaveCount(1);
    // A selected part holds the picture still even when the mouse leaves.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(1800);
    await expect(flip).toHaveAttribute("data-mode", "paused");
    const held = await frameOf(flip);
    await page.waitForTimeout(500);
    expect(await frameOf(flip)).toBe(held);
    await expectNoHorizontalOverflow(page);
    if (info.project.name === "mobile-375") {
      await page.getByTestId("studio-parts-viewer").scrollIntoViewIfNeeded();
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `dots-${locale}.png`) });
    }
  });

  test(`parts flipbook: reduced motion is a still frame, drag still turns it [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, locale);
    const flip = await readyFlipbook(page);
    await page.mouse.move(0, 0);
    await expect(flip).toHaveAttribute("data-mode", "still");
    const f0 = await frameOf(flip);
    const s0 = await srcOf(flip);
    await page.waitForTimeout(1500);
    expect(await frameOf(flip)).toBe(f0);
    expect(await srcOf(flip)).toBe(s0);
    // The tap dots are there (nothing is moving).
    await expect(page.getByTestId("studio-parts-viewer").getByTestId("studio-parts-spot").first()).toBeVisible();
    // Dragging still turns it by hand.
    const box = (await flip.boundingBox())!;
    const y = box.y + box.height * 0.5;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 8 });
    expect(await frameOf(flip)).not.toBe(f0);
    await page.mouse.up();
  });
}
