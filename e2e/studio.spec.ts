import { mkdirSync, readFileSync } from "node:fs";
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
const SHOTS2 = path.resolve(__dirname, "..", "test-results", "studio-phase2");
const SHOTS3 = path.resolve(__dirname, "..", "test-results", "studio-phase3");

for (const locale of LOCALES) {
  test(`design studio: idea to enclosure [${locale}]`, async ({ page }, info) => {
    test.setTimeout(180_000);
    const shoot = async (name: string) => {
      // Phone pictures for the owner: EN in the folder, AR in ar/ (RTL check).
      if (info.project.name !== "mobile-375") return;
      const dir = locale === "en" ? SHOTS : path.join(SHOTS, locale);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
    };
    // Phase 2 pictures: 375 × 812, EN in the folder, AR in ar/ (RTL check).
    const shoot2 = async (name: string) => {
      if (info.project.name !== "mobile-375") return;
      const dir = locale === "en" ? SHOTS2 : path.join(SHOTS2, locale);
      mkdirSync(dir, { recursive: true });
      await page.screenshot({ path: path.join(dir, `${name}.png`) });
    };
    // Phase 3 final set (P5-15a): 375 × 812, EN in the folder, AR in ar/.
    const shoot3 = async (name: string) => {
      if (info.project.name !== "mobile-375") return;
      const dir = locale === "en" ? SHOTS3 : path.join(SHOTS3, locale);
      mkdirSync(dir, { recursive: true });
      await page.waitForTimeout(400); // the step card's slide-in (340 ms) has finished
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
      // "Share picture" must take the download path (no OS share sheet in a test).
      try {
        Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
      } catch {
        /* read-only: the download path is still the fallback */
      }
    });
    // ?delay= slows the mocked calls a little, so the loading skeletons can be seen.
    const res = await page.goto(`/${locale}/e2e-fixtures/studio?delay=1500`);
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
    await shoot3("1-idea");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }));

    // ── Parts: picked automatically, floating on the plate in 3D ─────────
    await expect(shell).toHaveAttribute("data-step", "parts");
    await expect(page.getByTestId("studio-parts-list").locator("li").first()).toBeVisible();
    await expectCanvas(page.getByTestId("studio-parts-viewer"));
    await scrollUnderBars(page, page.getByTestId("studio-parts-viewer"));
    await shoot("2-parts");
    await shoot3("2-parts");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }));

    // ── Wiring: one credit, then our schematic ───────────────────────────
    await expect(shell).toHaveAttribute("data-step", "wiring");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") }));
    // A skeleton in the shape of the diagram while the (mocked) circuit is drawn.
    await expect(page.getByTestId("studio-wiring-skeleton")).toBeVisible();
    const schematic = page.getByTestId("studio-schematic");
    await expect(schematic.locator("svg").first()).toBeVisible();
    await expect(schematic).toHaveAttribute("dir", "ltr");
    await scrollUnderBars(page, page.getByText(msg(locale, "Studio", "headline_wiring")));
    await shoot("3-wiring");
    await shoot3("3-wiring");
    // Phone: the diagram renders at a legible scale (>= 720 px wide, sideways scroll), not squeezed to the column.
    const frameBox = await schematic.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    expect(frameBox.scroll, "schematic is drawn at a readable width").toBeGreaterThanOrEqual(Math.min(720, frameBox.client + 1));
    await scrollToBottom(page);
    await shoot("3b-wiring-bottom");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }));

    // ── Enclosure: draw it, the case renders in 3D ───────────────────────
    await expect(shell).toHaveAttribute("data-step", "enclosure");
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "drawItCredit") }));
    await expect(page.getByTestId("studio-enclosure-skeleton")).toBeVisible();
    await expect(page.getByRole("radiogroup", { name: msg(locale, "Studio", "colour") })).toBeVisible();
    await expectCanvas(page.getByTestId("studio-enclosure-viewer"));
    // Let the turntable settle, and bring the case under the sticky bars.
    await page.waitForTimeout(800);
    await scrollUnderBars(page, page.getByTestId("studio-enclosure-viewer"));
    await shoot("4-enclosure");
    await shoot3("4-enclosure");
    // The colour chips (last content) scroll fully above the sticky button.
    const chips = page.getByRole("radiogroup", { name: msg(locale, "Studio", "colour") });
    await scrollToBottom(page);
    await shoot("4b-enclosure-bottom");
    const chipsBox = await chips.boundingBox();
    const barTop = await page.evaluate(() => {
      const bar = Array.from(document.querySelectorAll("[data-step] .sticky")).at(-1);
      return bar ? bar.getBoundingClientRect().top : window.innerHeight;
    });
    expect((chipsBox?.y ?? 0) + (chipsBox?.height ?? 0), "colour chips are not under the sticky bar").toBeLessThanOrEqual(barTop + 1);
    // "Code" has no data of its own: not ticked before the visitor has been there.
    const codeDot = progress.getByRole("button", { name: new RegExp(msg(locale, "Studio", "step_code")) });
    await expect(codeDot).not.toContainText(msg(locale, "Studio", "stepDoneSr"));

    expect(taps, "taps from the idea to the enclosure").toBeLessThanOrEqual(6);

    // Share picture: a 1080 × 1080 PNG (download path here), plus a WhatsApp text link.
    const wa = page.getByTestId("studio-share-whatsapp");
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    const shareBtn = page.getByTestId("studio-share-picture");
    await expect(shareBtn).toHaveText(msg(locale, "Studio", "sharePicture"));
    const [download] = await Promise.all([page.waitForEvent("download"), shareBtn.click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    const png = readFileSync(await download.path());
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], "share picture is 1080 × 1080").toEqual([1080, 1080]);
    if (info.project.name === "mobile-375") {
      const dir = locale === "en" ? SHOTS3 : path.join(SHOTS3, locale);
      mkdirSync(dir, { recursive: true });
      await download.saveAs(path.join(dir, "share-picture.png"));
    }
    await expect(progress.locator('[aria-current="step"]')).toContainText(msg(locale, "Studio", "step_enclosure"));
    await expectNoHorizontalOverflow(page);

    // ── Phase 2 · Print parts: case + parts in 3D, "Take it apart", grams ──
    await tap(page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }));
    await expect(shell).toHaveAttribute("data-step", "print");
    await expect(progress.locator('[aria-current="step"]')).toContainText(msg(locale, "Studio", "step_print"));
    await expectCanvas(page.getByTestId("studio-print-viewer"));
    const list = page.getByTestId("studio-print-list");
    await expect(list.locator("li").first()).toBeVisible({ timeout: 20_000 });
    expect(await list.locator("li").count()).toBeGreaterThanOrEqual(3);
    await expect(list).toContainText(msg(locale, "Studio", "material_PLA"));
    await expect(page.getByTestId("studio-print-total")).toContainText(/\d/);
    const slider = page.getByTestId("studio-explode").locator('input[type="range"]');
    await expect(slider).toHaveValue("0");
    await page.waitForTimeout(600);
    await scrollUnderBars(page, page.getByTestId("studio-print-viewer"));
    await shoot2("5-print-parts");
    await shoot3("5-print");
    await slider.fill("1");
    await expect(slider).toHaveValue("1");
    await page.waitForTimeout(1200); // the viewer eases the parts apart (650 ms, wall-clock)
    await shoot2("5b-exploded");
    await scrollToBottom(page);
    await shoot2("5c-print-list");
    await expectNoHorizontalOverflow(page);

    // Request printing (mocked lead): the confirmation replaces the request.
    await page.getByRole("button", { name: msg(locale, "Studio", "requestPrint") }).click();
    await expect(page.getByTestId("studio-print-received")).toBeVisible();
    await expect(page.getByTestId("studio-print-received")).toContainText(msg(locale, "Studio", "printReceivedText"));

    // ── Code: real sketch for the chosen board, Copy works ──────────────
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "code");
    await expect(progress.getByRole("button", { name: new RegExp(msg(locale, "Studio", "step_make")) })).not.toContainText(
      msg(locale, "Studio", "stepDoneSr"),
    );
    const code = page.getByTestId("studio-code");
    await expect(code).toBeVisible();
    await expect(code).toHaveAttribute("dir", "ltr");
    await expect(code).toContainText("void setup()");
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.getByTestId("studio-copy-code").click();
    await expect(page.getByTestId("studio-copy-code")).toContainText(msg(locale, "Studio", "copied"));
    const copiedText = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedText).toContain("void setup()");
    await scrollUnderBars(page, page.getByTestId("studio-code-board"));
    await shoot2("6-code");
    await shoot3("6-code");
    await expectNoHorizontalOverflow(page);

    // ── Make ───────────────────────────────────────────────────────────
    await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();
    await expect(shell).toHaveAttribute("data-step", "make");
    await expect(page.getByRole("button", { name: new RegExp(msg(locale, "Studio", "getMade")) })).toBeVisible();
    await page.waitForTimeout(800); // the step change scrolls smoothly to the top
    await scrollUnderBars(page, page.getByText(msg(locale, "Studio", "headline_make")));
    await shoot2("7-make");
    await expect(page.getByTestId("studio-share-picture")).toBeVisible();
  });
}

// Phase 3 exit pictures for the owner (P5-15e): 375 × 812, EN, one per step, in
// test-results/studio-final/. The case is a lantern look (?look=; its label sits on the front face, in view) with "DESK BUDDY"
// raised on the lid, typed into the new "Name on the lid" field (local edit, no credit).
const FINAL = path.resolve(__dirname, "..", "test-results", "studio-final");

test("design studio: final phone pictures + name on the lid", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-375", "phone pictures only");
  test.setTimeout(240_000);
  const locale = "en" as const;
  mkdirSync(FINAL, { recursive: true });
  const shot = async (name: string) => {
    await page.waitForTimeout(450); // the step card's slide-in has finished
    await page.screenshot({ path: path.join(FINAL, name) });
  };
  // Still pictures: no turntable drift, the explode slider jumps.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const res = await page.goto(`/${locale}/e2e-fixtures/studio?look=lantern`);
  expect(res?.status()).toBe(200);
  const shell = page.getByTestId("studio-shell");

  // 1 · Idea
  const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
  await typeWhenHydrated(page, input, IDEA[locale]);
  await input.press("Enter");
  await page.getByTestId("studio-choices").getByRole("button").first().click();
  await expect(page.getByTestId("studio-idea-summary")).toBeVisible();
  await shot("1-idea.png");
  await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();

  // 2 · Parts
  await expect(shell).toHaveAttribute("data-step", "parts");
  await expectCanvas(page.getByTestId("studio-parts-viewer"));
  await page.waitForTimeout(800);
  await scrollUnderBars(page, page.getByTestId("studio-parts-viewer"));
  await shot("2-parts.png");
  await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();

  // 3 · Wiring
  await expect(shell).toHaveAttribute("data-step", "wiring");
  await page.getByRole("button", { name: msg(locale, "Studio", "wiringDrawCredit") }).click();
  await expect(page.getByTestId("studio-schematic").locator("svg").first()).toBeVisible();
  await scrollUnderBars(page, page.getByText(msg(locale, "Studio", "headline_wiring")));
  await shot("3-wiring.png");
  await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();

  // 4 · Enclosure: dome look, then the name on the lid
  await expect(shell).toHaveAttribute("data-step", "enclosure");
  await page.getByRole("button", { name: msg(locale, "Studio", "drawItCredit") }).click();
  const encViewer = page.getByTestId("studio-enclosure-viewer");
  await expectCanvas(encViewer);
  const caseState = encViewer.locator("[data-case]");
  await expect(caseState).toHaveAttribute("data-case", "ready", { timeout: 30_000 });
  const label = page.getByTestId("studio-lid-label");
  await expect(label).toHaveAttribute("maxlength", "16");
  const labelMsg = page.getByTestId("studio-lid-label-msg");
  await label.fill("مكتبي");
  await expect(labelMsg).toHaveText(msg(locale, "Studio", "labelScript"));
  await label.fill("DESK@HOME");
  await expect(labelMsg).toHaveText(msg(locale, "Studio", "labelChars"));
  await label.fill("DESK BUDDY");
  await expect(labelMsg).toHaveCount(0);
  // 400 ms debounce, then the worker rebuilds the lid (the old case stays on screen meanwhile).
  await page.waitForTimeout(700);
  await expect(caseState).toHaveAttribute("data-case", "ready", { timeout: 30_000 });
  await expect(labelMsg).toHaveCount(0);
  await page.waitForTimeout(600);
  await scrollUnderBars(page, encViewer);
  await shot("4-enclosure.png");
  await page.getByRole("button", { name: msg(locale, "Studio", "next"), exact: true }).click();

  // 5 · Print, taken apart ~0.7
  await expect(shell).toHaveAttribute("data-step", "print");
  await expect(page.getByTestId("studio-print-list").locator("li").first()).toBeVisible({ timeout: 30_000 });
  const slider = page.getByTestId("studio-explode").locator('input[type="range"]');
  await slider.fill("0.7");
  await expect(slider).toHaveValue("0.7");
  await page.waitForTimeout(1200);
  await scrollUnderBars(page, page.getByTestId("studio-print-viewer"));
  await shot("5-print.png");
  await page.getByRole("button", { name: msg(locale, "Studio", "skipToCode") }).click();

  // 6 · Code
  await expect(shell).toHaveAttribute("data-step", "code");
  await expect(page.getByTestId("studio-code")).toContainText("void setup()");
  await scrollUnderBars(page, page.getByTestId("studio-code-board"));
  await shot("6-code.png");
  await expectNoHorizontalOverflow(page);
});

/** Scroll so the end of the step card sits at the bottom of the screen (the sticky bar is then at rest). */
async function scrollToBottom(page: Page) {
  await page.evaluate(() => {
    const card = document.querySelector("section[data-step]");
    if (!card) return;
    window.scrollTo({ top: card.getBoundingClientRect().bottom + window.scrollY - window.innerHeight, behavior: "instant" as ScrollBehavior });
  });
  await page.waitForTimeout(150);
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
