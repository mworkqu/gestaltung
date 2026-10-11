import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// P5-16 Phase 2b — the real product in the Studio, on the TEST-ONLY fixture
// /{locale}/e2e-fixtures/studio?product=1&idea=<key>: the five acceptance ideas
// with parts picked and wired; the product endpoints are answered inside the
// geometry worker (archetype defaults, fixed vision score) — no AI, no DB, no
// credit, nothing written.
//
// Checks: pictures appear after Parts (made in the background while on Wiring);
// before "Create my CAD" there is no 3D view, no canvas and no STL; "Create my
// CAD" opens the 3D product + "Take it apart"; the Print step lists one STL per
// printed body. Guest limit, the template fallback, out of credits and the
// Engineer view too. Screenshots (iso picture + taken apart) for the five ideas
// go to test-results/p516/.

const SHOTS = path.resolve(__dirname, "..", "test-results", "p516");
const IDEAS = ["plant_waterer", "desk_lamp", "cat_feeder", "doorbell", "tv_remote"] as const;

function pmsg(locale: Loc, key: string): string {
  const all = JSON.parse(readFileSync(path.resolve(__dirname, "..", "messages", `${locale}.json`), "utf8")) as {
    Studio: { product: Record<string, string> };
  };
  const v = all.Studio.product[key];
  if (typeof v !== "string") throw new Error(`missing message ${locale}:Studio.product.${key}`);
  return v;
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

async function pictures(page: Page) {
  const pics = page.getByTestId("studio-product-picture");
  await expect(pics.first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("studio-product-pictures")).toHaveAttribute("data-phase", "ready", { timeout: 60_000 });
  return pics;
}

async function scrollTo(page: Page, target: Locator) {
  const handle = await target.elementHandle();
  await page.evaluate((el) => {
    if (!el) return;
    // Just below the sticky header + progress line.
    const bars = Array.from(document.querySelectorAll("header, nav"))
      .filter((n) => getComputedStyle(n).position === "sticky")
      .reduce((m, n) => Math.max(m, n.getBoundingClientRect().bottom), 0);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - Math.max(bars, 190) - 12, behavior: "instant" as ScrollBehavior });
  }, handle);
  await page.waitForTimeout(250);
}

/** A clipped page screenshot (an element screenshot waits for a "stable" box, which a turning 3D view never is). */
async function shotOf(page: Page, target: Locator, file: string) {
  await scrollTo(page, target);
  const b = await target.boundingBox();
  if (!b) throw new Error("no box");
  await page.screenshot({ path: file, clip: { x: b.x, y: Math.max(0, b.y), width: b.width, height: b.height } });
}

for (const locale of LOCALES) {
  test(`studio product: Plant Waterer pictures → Create my CAD → take apart → STL per body [${locale}]`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const dir = path.join(SHOTS, info.project.name, locale);
    mkdirSync(dir, { recursive: true });
    await open(page, locale, "idea=plant_waterer&step=wiring");
    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "wiring");
    // The designs start in the background right after Parts: go on to the Enclosure step.
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "enclosure");

    const pics = await pictures(page);
    const n = await pics.count();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    const cards = page.getByTestId("studio-product-card");
    await expect(cards.first()).toHaveAttribute("data-archetype", "stake_device");
    await expect(cards.first()).toContainText(pmsg(locale, "whyLabel"));
    const archetypes = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-archetype")));
    expect(new Set(archetypes).size).toBe(archetypes.length);

    // Before payment: pictures only.
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("studio-product-viewer")).toHaveCount(0);
    await expect(page.getByTestId("studio-product-stl")).toHaveCount(0);
    await expect(page.getByText(msg(locale, "Studio", "downloadStl"))).toHaveCount(0);
    await expect(page.getByTestId("studio-product-progress")).not.toContainText(/\d/);
    await expectNoHorizontalOverflow(page);
    await scrollTo(page, page.getByTestId("studio-product-pictures"));
    await page.screenshot({ path: path.join(dir, "1-pictures.png") });

    // Tap the first card (chosen), then Create my CAD.
    await cards.first().click();
    await expect(cards.first()).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("studio-create-cad").click();
    const viewer = page.getByTestId("studio-product-viewer");
    await expect(viewer.locator("[data-viewer=product]")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
    await expect(viewer.locator("canvas")).toHaveCount(1);
    await page.waitForTimeout(800);
    await scrollTo(page, viewer);
    await page.screenshot({ path: path.join(dir, "2-viewer.png") });
    await page.getByTestId("studio-take-apart").click();
    await expect(viewer.locator("[data-viewer=product]")).toHaveAttribute("data-explode", "apart");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(dir, "3-apart.png") });
    await expectNoHorizontalOverflow(page);

    // Print step: one STL per printed body (head, stake, tank, …).
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "print");
    const rows = page.getByTestId("studio-product-stl");
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    const roles = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-role")));
    expect(roles).toContain("stake");
    expect(roles).toContain("reservoir");
    expect(roles.length).toBeGreaterThanOrEqual(3);
    const download = page.waitForEvent("download");
    await rows.first().getByRole("button").click();
    expect((await download).suggestedFilename()).toMatch(/\.stl$/);
    await page.screenshot({ path: path.join(dir, "4-print.png"), fullPage: true });
  });
}

test("studio product: Try another gives different designs [en]", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "once is enough");
  test.setTimeout(120_000);
  await open(page, "en", "idea=plant_waterer&step=enclosure");
  await pictures(page);
  const cards = page.getByTestId("studio-product-card");
  const before = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-archetype")));
  await page.getByTestId("studio-try-another").click();
  await expect(page.getByTestId("studio-product-pictures")).toHaveAttribute("data-phase", "ready", { timeout: 60_000 });
  await expect(async () => {
    const after = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-archetype")));
    expect(after.length).toBeGreaterThanOrEqual(2);
    for (const a of after) expect(before).not.toContain(a);
  }).toPass({ timeout: 30_000 });
});

test("studio product: guest limit, fallback, out of credits, engineer view [en]", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "once is enough");
  test.setTimeout(150_000);
  // Guest limit: no design builds left today.
  await open(page, "en", "idea=plant_waterer&step=enclosure&productlimit=0");
  await expect(page.getByTestId("studio-product-limit")).toContainText(pmsg("en", "guestLimit"), { timeout: 30_000 });

  // The pipeline fails → the template enclosure flow (never a blank screen).
  await page.goto("/en/e2e-fixtures/studio?product=1&idea=plant_waterer&step=enclosure&productfail=1");
  await expect(page.getByTestId("studio-product-fallback")).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("button", { name: msg("en", "Studio", "drawItCredit") })).toBeVisible({ timeout: 20_000 });

  // Out of credits → the usual AccessNote; nothing opens.
  await page.goto("/en/e2e-fixtures/studio?product=1&idea=plant_waterer&step=enclosure&unlock=no_credits");
  await pictures(page);
  await page.getByTestId("studio-create-cad").click();
  await expect(page.getByText(msg("en", "Credits", "blockedNoCad"))).toBeVisible();
  await expect(page.locator("canvas")).toHaveCount(0);

  // Engineer view (super_admin only).
  await page.goto("/en/e2e-fixtures/studio?product=1&idea=plant_waterer&step=enclosure&admin=1");
  await pictures(page);
  const eng = page.getByTestId("studio-product-engineer");
  await eng.locator("summary").first().click();
  await expect(eng.getByTestId("studio-product-engineer-design").first()).toContainText("8", { timeout: 20_000 });
});

test("studio product: the five acceptance ideas (iso picture + taken apart) [en]", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "screenshots at desktop size");
  test.setTimeout(400_000);
  mkdirSync(SHOTS, { recursive: true });
  for (const idea of IDEAS) {
    await open(page, "en", `idea=${idea}&step=enclosure`);
    const pics = await pictures(page);
    await pics.first().screenshot({ path: path.join(SHOTS, `${idea}-iso.png`) });
    await page.getByTestId("studio-create-cad").click();
    const box = page.getByTestId("studio-product-viewer");
    await expect(box.locator("[data-viewer=product]")).toHaveAttribute("data-ready", "1", { timeout: 60_000 });
    await page.waitForTimeout(800);
    await shotOf(page, box, path.join(SHOTS, `${idea}-3d.png`));
    await page.getByTestId("studio-take-apart").click();
    await page.waitForTimeout(1800);
    await shotOf(page, box, path.join(SHOTS, `${idea}-exploded.png`));
  }
});
