import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// Owner 2026-10-11: "load the animated load screen, then load the engine only if the
// user is heading to the CAD". On the TEST-ONLY Studio fixture (product pipeline on,
// endpoints answered inside the worker, nothing written):
//  * Idea: no 3D engine on the page and no geometry worker yet;
//  * Parts: a worker-drawn PICTURE of the parts (no canvas), Wiring and the Enclosure
//    pictures: still no three.js / R3F chunk requested by the page;
//  * "Create my CAD": the engine chunk IS requested and the 3D product opens.
// The engine chunks are read from the build (.next/react-loadable-manifest.json: what
// ViewerLazy -> ./Viewer and ProductViewerLazy -> ./ProductViewer load). Only the
// page's own requests count (its Resource Timing): the worker has its own three.js.

const SHOTS = path.resolve(__dirname, "..", "test-results", "engine");

function engineChunks(): string[] {
  const file = path.resolve(__dirname, "..", ".next", "react-loadable-manifest.json");
  if (!existsSync(file)) throw new Error("run `next build` first");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, { files?: string[] }>;
  const files = new Set<string>();
  for (const [key, entry] of Object.entries(manifest)) {
    const k = key.replace(/\\/g, "/");
    if (/components\/studio\/viewer\/(ViewerLazy|ProductViewerLazy)\.tsx -> \.\/(Viewer|ProductViewer)$/.test(k)) {
      for (const f of entry.files ?? []) if (f.endsWith(".js")) files.add(f.split("/").pop()!);
    }
  }
  // Chunks every page loads up front (React, next-intl…) are listed by the loadable manifest
  // too: only the ones no page loads initially are the engine.
  const pages = JSON.parse(readFileSync(path.resolve(__dirname, "..", ".next", "app-build-manifest.json"), "utf8")) as { pages: Record<string, string[]> };
  for (const list of Object.values(pages.pages)) for (const f of list) files.delete(f.split("/").pop()!);
  if (files.size === 0) throw new Error("no engine chunks found in the build manifest");
  return [...files];
}

/** Engine chunks the PAGE (main thread) has requested so far. */
async function engineRequested(page: Page, chunks: string[]): Promise<string[]> {
  const names = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name.split("?")[0].split("/").pop() ?? ""));
  return chunks.filter((c) => names.includes(c));
}

async function open(page: Page, locale: Loc, query: string) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const res = await page.goto(`/${locale}/e2e-fixtures/studio?product=1&${query}`);
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  await expectLocale(page, locale);
}

test("studio engine: nothing 3D and no worker on the Idea step [en]", async ({ page }) => {
  const chunks = engineChunks();
  await open(page, "en", "");
  await expect(page.getByTestId("studio-shell")).toHaveAttribute("data-step", "idea");
  const input = page.getByRole("textbox", { name: msg("en", "Studio", "ideaPlaceholder") });
  await expect(async () => {
    await input.fill("A plant waterer for my desk");
    await expect(input).toHaveValue("A plant waterer for my desk", { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await page.waitForTimeout(1500);
  expect(await engineRequested(page, chunks)).toEqual([]);
  expect(page.workers().filter((w) => w.url().includes("studio-geometry"))).toHaveLength(0);
});

for (const locale of LOCALES) {
  test(`studio engine: parts picture, no engine before Create my CAD, engine after [${locale}]`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const chunks = engineChunks();
    const dir = path.join(SHOTS, info.project.name);
    mkdirSync(dir, { recursive: true });
    await open(page, locale, "idea=plant_waterer&step=parts");
    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "parts");

    // Parts: the worker's picture with a tap target per part (the part list is unchanged).
    const box = page.getByTestId("studio-parts-viewer");
    const picture = box.getByTestId("studio-parts-picture");
    await expect(picture).toBeVisible({ timeout: 60_000 });
    await expect(async () => {
      expect(await picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(50);
    }).toPass({ timeout: 10_000 });
    await expect(box.locator("canvas")).toHaveCount(0);
    // The tap dots show while the parts are not turning: hold the picture (mouse over it /
    // a tap on a touch screen), then tap a dot.
    const flip = box.getByTestId("studio-parts-flipbook");
    if (info.project.name === "mobile-375") await flip.tap({ position: { x: 30, y: 90 } });
    else await flip.hover({ position: { x: 30, y: 90 } });
    const spots = box.getByTestId("studio-parts-spot");
    const rows = page.getByTestId("studio-part-row");
    await expect(spots).toHaveCount(await rows.count());
    await spots.first().click();
    await expect(spots.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-testid="studio-part-row"][data-selected="true"]')).toHaveCount(1);
    await expectNoHorizontalOverflow(page);
    await box.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(dir, `parts-${locale}.png`), fullPage: false });
    expect(await engineRequested(page, chunks)).toEqual([]);

    // Wiring (already drawn on this fixture).
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "wiring");
    expect(await engineRequested(page, chunks)).toEqual([]);

    // Enclosure: the pictures (made in the worker), still no engine on the page.
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "enclosure");
    await expect(page.getByTestId("studio-product-picture").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("studio-product-pictures")).toHaveAttribute("data-phase", "ready", { timeout: 60_000 });
    await page.waitForTimeout(1500);
    expect(await engineRequested(page, chunks)).toEqual([]);
    await expect(page.locator("canvas")).toHaveCount(0);

    // Create my CAD: the loader, then the engine downloads and the 3D product opens.
    await page.getByTestId("studio-create-cad").click();
    const viewer = page.getByTestId("studio-product-viewer");
    await expect(viewer.locator("[data-viewer=product]")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
    expect((await engineRequested(page, chunks)).length).toBeGreaterThan(0);
  });
}

test("studio engine: out of credits never loads the engine [en]", async ({ page }) => {
  test.setTimeout(120_000);
  const chunks = engineChunks();
  await open(page, "en", "idea=plant_waterer&step=enclosure&unlock=no_credits");
  await expect(page.getByTestId("studio-product-pictures")).toHaveAttribute("data-phase", "ready", { timeout: 60_000 });
  await page.getByTestId("studio-create-cad").click();
  await expect(page.getByText(msg("en", "Credits", "blockedNoCad"))).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await engineRequested(page, chunks)).toEqual([]);
});
