import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// W6 — Enclosure: the shape follows the idea; everything 3D in one step.
// TEST-ONLY fixture /{locale}/e2e-fixtures/studio?preset=plant opens the Studio
// on the Enclosure step with "automatic small plant watering monitor" already
// picked and wired (mock StudioApi: no Supabase, no AI, no credit, nothing written).
//
// Checks: the drawn case is a stake pod with its "why this shape" line; "Other
// shapes" offers three DIFFERENT templates and a tap swaps the case (a local
// edit, no API call); "Take it apart" + slider sit under the 3D view and show
// the printed stands; the Print step has no 3D view, lists the soil spike as its
// own printed part, with grams and STL downloads.

const SHOTS = path.resolve(__dirname, "..", "test-results", "studio-w6");

/** Nested copy (Studio.shape.*) — e2e/fixtures.ts msg() reads flat keys only. */
function shapeMsg(locale: Loc, key: string): string {
  const all = JSON.parse(readFileSync(path.resolve(__dirname, "..", "messages", `${locale}.json`), "utf8")) as {
    Studio: { shape: Record<string, string> };
  };
  const v = all.Studio.shape[key];
  if (typeof v !== "string") throw new Error(`missing message ${locale}:Studio.shape.${key}`);
  return v;
}

for (const locale of LOCALES) {
  test(`studio enclosure: plant idea → stake pod, other shapes, take it apart [${locale}]`, async ({ page }, info) => {
    test.setTimeout(150_000);
    const shoot = async (name: string) => {
      const dir = path.join(SHOTS, info.project.name, locale);
      mkdirSync(dir, { recursive: true });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
    };
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
      } catch {
        /* storage blocked */
      }
    });
    // Any studio API call would be a bug here (shape taps are local edits).
    const apiCalls: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/studio/")) apiCalls.push(r.url());
    });

    const res = await page.goto(`/${locale}/e2e-fixtures/studio?preset=plant`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, locale);
    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "enclosure");

    // ── Draw it: the plant idea gets a stake pod + its reason ──────────────
    await clickWhenHydrated(page.getByRole("button", { name: msg(locale, "Studio", "drawItCredit") }));
    const viewer = page.getByTestId("studio-enclosure-viewer");
    const caseState = viewer.locator("[data-case]");
    await expect(caseState).toHaveAttribute("data-case", "ready", { timeout: 40_000 });
    const why = page.getByTestId("studio-shape-why");
    await expect(why).toHaveAttribute("data-template", "stake_pod");
    await expect(why).toContainText(shapeMsg(locale, "whyLabel"));
    await expect(why).toContainText(shapeMsg(locale, "why_plant"));
    await page.waitForTimeout(800);
    await scrollUnderBars(page, viewer);
    await shoot("1-stake-pod");

    // ── Other shapes: three different templates, none of them the stake pod ─
    const others = page.getByTestId("studio-other-shapes");
    const chips = others.getByRole("button");
    await expect(chips).toHaveCount(3);
    const templates = await chips.evaluateAll((els) => els.map((e) => e.getAttribute("data-template")));
    expect(new Set(templates).size).toBe(3);
    expect(templates).not.toContain("stake_pod");
    // Pot-friendly alternatives come first for a plant.
    expect(["dome_base", "puck"]).toContain(templates[0]);

    // Colour survives a shape change.
    const colours = page.getByRole("radiogroup", { name: msg(locale, "Studio", "colour") });
    await colours.getByRole("radio", { name: msg(locale, "Studio", "colour_sage") }).click();
    await chips.first().click();
    await expect(why).toHaveAttribute("data-template", templates[0]!);
    await expect(colours.getByRole("radio", { name: msg(locale, "Studio", "colour_sage") })).toHaveAttribute("aria-checked", "true");
    // Built in the background already: the new case is up at once.
    await expect(caseState).toHaveAttribute("data-case", "ready", { timeout: 15_000 });
    await expect(others.getByRole("button", { name: new RegExp(shapeMsg(locale, "name_stake_pod")) })).toBeVisible();
    await scrollUnderBars(page, viewer);
    await shoot("2-other-shape");
    // Back to the stake pod.
    await others.locator('[data-template="stake_pod"]').click();
    await expect(why).toHaveAttribute("data-template", "stake_pod");
    await expect(caseState).toHaveAttribute("data-case", "ready", { timeout: 15_000 });

    // ── Take it apart under the 3D view ────────────────────────────────────
    const toggle = page.getByTestId("studio-take-apart");
    await expect(toggle).toHaveText(msg(locale, "Studio", "takeApart"));
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const slider = page.getByTestId("studio-explode").locator('input[type="range"]');
    await expect(slider).toHaveAttribute("aria-label", shapeMsg(locale, "apartAmount"));
    await slider.fill("1");
    await expect(slider).toHaveValue("1");
    // The printed stands and clips are shown in place once built.
    await expect(page.getByTestId("studio-explode")).toContainText(shapeMsg(locale, "holders"), { timeout: 30_000 });
    await page.waitForTimeout(1200);
    await scrollUnderBars(page, viewer);
    await shoot("3-taken-apart");
    await expectNoHorizontalOverflow(page);
    expect(apiCalls, "shape and take-apart taps never call the server").toEqual([]);

    // ── Print: no 3D here, the soil spike is its own printed part ─────────
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "print");
    await expect(page.getByTestId("studio-print-viewer")).toHaveCount(0);
    await expect(page.getByTestId("studio-explode")).toHaveCount(0);
    const list = page.getByTestId("studio-print-list");
    await expect(list.locator("li").first()).toBeVisible({ timeout: 30_000 });
    await expect(list).toContainText(locale === "ar" ? "وتد التربة" : "Soil spike");
    await expect(list).toContainText(msg(locale, "Studio", "material_PETG"));
    await expect(page.getByTestId("studio-print-total")).toContainText(/\d/);
    await expect(page.getByRole("button", { name: msg(locale, "Studio", "downloadAllStl") })).toBeEnabled();
    await scrollUnderBars(page, list);
    await shoot("4-print-list");
    await expectNoHorizontalOverflow(page);
  });
}

/** Retry the first click until React has hydrated the button (the fixture page is server-rendered). */
async function clickWhenHydrated(target: Locator) {
  await expect(target).toBeEnabled({ timeout: 20_000 });
  await expect(async () => {
    await target.click();
    await expect(target).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/** Scroll so the element sits just below the sticky header + progress line. */
async function scrollUnderBars(page: Page, target: Locator) {
  const handle = await target.elementHandle();
  await page.evaluate((el) => {
    if (!el) return;
    const bars = Array.from(document.querySelectorAll("header, nav"))
      .filter((n) => getComputedStyle(n).position === "sticky")
      .reduce((m, n) => Math.max(m, n.getBoundingClientRect().bottom), 0);
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - bars - 12, behavior: "instant" as ScrollBehavior });
  }, handle);
  await page.waitForTimeout(150);
}
