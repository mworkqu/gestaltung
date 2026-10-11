import { readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, LOCALES, msg, test } from "./fixtures";

// W5 · the wiring diagram viewer, on the TEST-ONLY studio fixture
// (/{locale}/e2e-fixtures/studio: mocked StudioApi, no Supabase write, no AI).
// Walks idea → parts → "Draw my wiring" and checks, at 1280 (desktop project)
// and 375 (mobile-375 project): the whole diagram is visible when it opens,
// Fit and the zoom buttons change the % label, Ctrl + wheel zooms, dragging
// pans, and the full-screen dialog opens at full height and closes on Esc.

const IDEA: Record<(typeof LOCALES)[number], string> = {
  en: "A little desk friend that lights up when I walk in",
  ar: "رفيق صغير للمكتب يضيء عندما أدخل",
};

type Loc = (typeof LOCALES)[number];

/** Nested "Studio.schematic.*" strings (the shared msg() helper reads one level). */
function schematic(locale: Loc, key: string): string {
  const all = JSON.parse(readFileSync(path.resolve(__dirname, "..", "messages", `${locale}.json`), "utf8")) as {
    Studio: { schematic: Record<string, string> };
  };
  return all.Studio.schematic[key];
}

const percent = async (loc: Locator) => Number(((await loc.textContent()) ?? "").replace("%", "").trim());

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("element has no box");
  return b;
}

for (const locale of LOCALES) {
  test(`wiring viewer: fit, zoom, pan, full screen [${locale}]`, async ({ page }) => {
    test.setTimeout(120_000);
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

    // idea → parts → wiring (same walk as studio.spec.ts)
    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await expect(async () => {
      await input.fill(IDEA[locale]);
      await expect(input).toHaveValue(IDEA[locale], { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await input.press("Enter");
    await page.getByTestId("studio-choices").getByRole("button").first().click();
    await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "parts");
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "wiring");
    await page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") }).click();

    const frame = page.getByTestId("studio-schematic");
    const content = page.getByTestId("studio-schematic-content");
    const label = page.getByTestId("studio-schematic-zoom");
    await expect(content.locator("svg").first()).toBeVisible();
    await expect(frame).toHaveAttribute("dir", "ltr"); // the drawing stays left to right, also in Arabic
    await frame.scrollIntoViewIfNeeded();

    // ── Opens fitted: the whole diagram is inside the frame ──────────────
    const inside = async () => {
      const f = await box(frame);
      const c = await box(content);
      expect(c.x).toBeGreaterThanOrEqual(f.x - 1);
      expect(c.y).toBeGreaterThanOrEqual(f.y - 1);
      expect(c.x + c.width).toBeLessThanOrEqual(f.x + f.width + 1);
      expect(c.y + c.height).toBeLessThanOrEqual(f.y + f.height + 1);
    };
    await inside();
    const fitted = await percent(label);
    expect(fitted).toBeGreaterThan(0);

    // Frame: full content width, height min(75dvh, 760px).
    const f0 = await box(frame);
    const viewportH = page.viewportSize()?.height ?? 800;
    expect(f0.height).toBeLessThanOrEqual(Math.min(0.75 * viewportH, 760) + 1);
    expect(f0.height).toBeGreaterThan(200);
    const parent = await box(frame.locator("xpath=.."));
    expect(f0.width).toBeGreaterThanOrEqual(parent.width - 2);

    // ── Buttons change the % label; Fit brings it back ───────────────────
    const zoomIn = page.getByRole("button", { name: schematic(locale, "zoomIn") });
    const zoomOut = page.getByRole("button", { name: schematic(locale, "zoomOut") });
    const fit = page.getByRole("button", { name: schematic(locale, "fit") });
    await zoomIn.click();
    await zoomIn.click();
    await expect.poll(() => percent(label)).toBeGreaterThan(fitted);
    const zoomed = await percent(label);
    await zoomOut.click();
    await expect.poll(() => percent(label)).toBeLessThan(zoomed);
    await fit.click();
    await expect.poll(() => percent(label)).toBe(fitted);
    await inside();

    // ── Drag pans (zoom in first so there is room to move) ───────────────
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    const before = await box(content);
    // A point of the frame that is on screen (on a phone the frame is taller than what is visible).
    const f1 = await box(frame);
    const vh = page.viewportSize()?.height ?? 800;
    const top = Math.max(f1.y, 0);
    const bottom = Math.min(f1.y + f1.height, vh);
    const cx = f1.x + f1.width / 2;
    const cy = (top + bottom) / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 80, cy - 40, { steps: 6 });
    await page.mouse.up();
    const after = await box(content);
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), "dragging moves the drawing").toBeGreaterThan(5);

    // ── Ctrl + wheel zooms at the cursor (desktop only: no wheel on a phone) ─
    if (test.info().project.name === "desktop") {
      await fit.click();
      const base = await percent(label);
      await page.mouse.move(cx, cy);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -300);
      await page.keyboard.up("Control");
      await expect.poll(() => percent(label)).toBeGreaterThan(base);
    }

    // ── Full screen: a dialog at 100dvh, Esc closes ──────────────────────
    await fit.click();
    await page.getByRole("button", { name: schematic(locale, "fullscreen") }).click();
    const dialog = page.getByTestId("studio-schematic-dialog");
    await expect(dialog).toBeVisible();
    const full = page.getByTestId("studio-schematic-full");
    await expect(full.locator("svg").first()).toBeVisible();
    const d = await box(dialog);
    expect(d.height).toBeGreaterThanOrEqual((page.viewportSize()?.height ?? 800) - 2);
    const fullContent = page.getByTestId("studio-schematic-full-content");
    await expect(async () => {
      const ff = await box(full);
      const cc = await box(fullContent);
      expect(cc.x).toBeGreaterThanOrEqual(ff.x - 1);
      expect(cc.x + cc.width).toBeLessThanOrEqual(ff.x + ff.width + 1);
      expect(cc.y + cc.height).toBeLessThanOrEqual(ff.y + ff.height + 1);
    }).toPass({ timeout: 5000 });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await noOverflow(page);
  });
}

async function noOverflow(page: Page) {
  const w = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, i: window.innerWidth }));
  expect(w.s).toBeLessThanOrEqual(w.i);
}
