import { mkdirSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// Design Studio (P5-13 Phase 1) on the TEST-ONLY route /{locale}/e2e-fixtures/studio
// (lib/e2e-fixtures.ts: E2E_FIXTURES=1 on the server, which playwright.config.ts
// sets; never reachable on Vercel). The page runs StudioShell on a mock
// StudioApi (lib/studio/client/mock.ts): canned answers through our real rules
// (netlist, schematic, enclosure), no Supabase write, no AI, no credit.
//
// Walk: idea (type + tap a choice) → summary → Next → parts (3D plate canvas)
// → Next → wiring (SVG) → Next → enclosure "Draw it" → a <canvas> with a real
// size. The visitor needs at most 6 taps from the idea to the enclosure.

const IDEA: Record<(typeof LOCALES)[number], string> = {
  en: "A little desk friend that lights up when I walk in",
  ar: "رفيق صغير للمكتب يضيء عندما أدخل",
};

const SHOTS = path.resolve(__dirname, "..", "test-results", "studio-phase1");

for (const locale of LOCALES) {
  test(`design studio: idea to enclosure [${locale}]`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const shoot = async (name: string) => {
      // Phone pictures for the owner: EN in the folder, AR in ar/ (RTL check).
      if (info.project.name !== "mobile-375") return;
      const dir = locale === "en" ? SHOTS : path.join(SHOTS, locale);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
    };
    let taps = 0;
    const tap = async (target: Locator) => {
      await expect(target).toBeEnabled();
      await target.click();
      taps += 1;
    };

    // No cookie notice over the pictures: a privacy-preserving "declined" choice.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
      } catch {
        /* storage blocked */
      }
    });
    const res = await page.goto(`/${locale}/e2e-fixtures/studio`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1 (playwright.config.ts webServer.env)").toBe(200);
    await expectLocale(page, locale);

    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "idea");
    // The progress line is a nav list with the current step marked.
    const progress = page.getByRole("navigation", { name: msg(locale, "Studio", "progressLabel") });
    await expect(progress.locator('[aria-current="step"]')).toContainText(msg(locale, "Studio", "step_idea"));

    // ── Idea: the input is focused and ready; type, Enter, tap a choice ──
    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await expect(input).toBeFocused();
    await typeWhenHydrated(page, input, IDEA[locale]);
    await input.press("Enter");

    const choices = page.getByTestId("studio-choices");
    await expect(choices).toBeVisible();
    // Refocused after the reply.
    await expect(page.getByRole("textbox", { name: msg(locale, "Studio", "yourAnswer") })).toBeFocused();
    await tap(choices.getByRole("button").first());

    const summary = page.getByTestId("studio-idea-summary");
    await expect(summary).toBeVisible();
    await shoot("1-idea-summary");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }));

    // ── Parts: picked automatically, floating on the plate in 3D ─────────
    await expect(shell).toHaveAttribute("data-step", "parts");
    await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible();
    await expectCanvas(page.getByTestId("studio-parts-viewer"));
    await scrollUnderBars(page, page.getByTestId("studio-parts-viewer"));
    await shoot("2-parts");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }));

    // ── Wiring: one credit, then our schematic ───────────────────────────
    await expect(shell).toHaveAttribute("data-step", "wiring");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") }));
    const schematic = page.getByTestId("studio-schematic");
    await expect(schematic.locator("svg").first()).toBeVisible();
    await expect(schematic).toHaveAttribute("dir", "ltr");
    await scrollUnderBars(page, page.getByText(msg(locale, "Studio", "headline_wiring")));
    await shoot("3-wiring");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }));

    // ── Enclosure: draw it, the case renders in 3D ───────────────────────
    await expect(shell).toHaveAttribute("data-step", "enclosure");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "drawItCredit") }));
    await expect(page.getByRole("radiogroup", { name: msg(locale, "Studio", "colour") })).toBeVisible();
    await expectCanvas(page.getByTestId("studio-enclosure-viewer"));
    // Let the turntable settle, and bring the case under the sticky bars.
    await page.waitForTimeout(800);
    await scrollUnderBars(page, page.getByTestId("studio-enclosure-viewer"));
    await shoot("4-enclosure");

    expect(taps, "taps from the idea to the enclosure").toBeLessThanOrEqual(6);
    await expect(progress.locator('[aria-current="step"]')).toContainText(msg(locale, "Studio", "step_enclosure"));
    await expectNoHorizontalOverflow(page);
  });
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

/** Wait for hydration: the controlled input keeps text only once React is attached. */
async function typeWhenHydrated(page: Page, input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  void page;
}

/** A WebGL canvas with a real, non-zero size inside the viewer box. */
async function expectCanvas(box: Locator) {
  const canvas = box.locator("canvas").first();
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(async () => {
    const b = await canvas.boundingBox();
    expect(b?.width ?? 0).toBeGreaterThan(50);
    expect(b?.height ?? 0).toBeGreaterThan(50);
  }).toPass({ timeout: 10_000 });
}
