import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Locator, Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// W3 — the idea step as a real conversation beside a live spec card, on the
// TEST-ONLY studio fixture (/{locale}/e2e-fixtures/studio, E2E_FIXTURES=1). The
// fixture's mock StudioApi runs the SAME deterministic guards as the server
// (lib/studio/ai/spec-guards.ts) and never calls an AI provider or writes data.
//
//  1. "automatic small plant watering monitor": the card fills from the words at
//     once (pump + soil placement), sits beside the chat (end side, mirrored in
//     Arabic) or above it on phones; after "Looks right — next" the parts include
//     the pump; back on the idea step the chat still works, "make it solar"
//     updates the card and offers "Update my parts".
//  2. "Build something new with Arduino": ONE question with chips, never an echo.

const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, "test-results", "w3-idea");

const PLANT: Record<Loc, string> = {
  en: "automatic small plant watering monitor",
  ar: "جهاز صغير يسقي النبتة تلقائياً",
};
const SOLAR: Record<Loc, string> = { en: "make it solar", ar: "اجعله يعمل بالطاقة الشمسية" };
const SOLAR_CHANGED: Record<Loc, string> = { en: "Now solar powered", ar: "يعمل بالطاقة الشمسية الآن" };
const QUESTION_TEXT: Record<Loc, string> = { en: "do you know what is ur10?", ar: "هل تعرف ما هو UR10؟" };
const QUESTION_ANSWER: Record<Loc, string> = {
  en: "A UR10 is a big industrial robot arm.",
  ar: "UR10 ذراع روبوت صناعية كبيرة.",
};
const VAGUE: Record<Loc, string> = { en: "Build something new with Arduino", ar: "شيء باستخدام الأردوينو" };
const VAGUE_Q: Record<Loc, string> = { en: "Fun! What should it do?", ar: "رائع! ماذا تريده أن يفعل؟" };

/** Nested Studio.ideaCard.* copy (fixtures' msg() reads flat keys only). */
function card(locale: Loc, key: string): string {
  const all = JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")) as {
    Studio: { ideaCard: Record<string, string> };
  };
  const v = all.Studio.ideaCard[key];
  if (typeof v !== "string") throw new Error(`missing Studio.ideaCard.${key}`);
  return v;
}

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
}

async function typeWhenHydrated(input: Locator, text: string) {
  await expect(async () => {
    await input.fill(text);
    await expect(input).toHaveValue(text, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

const row = (page: Page, id: string) => page.getByTestId("studio-idea-facts").locator(`[data-row="${id}"]`);

for (const locale of LOCALES) {
  test(`idea W3: plant idea gets a pump, the card sits beside the chat, refinement updates it [${locale}]`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const phone = info.project.name === "mobile-375";
    const shot = async (name: string) => {
      mkdirSync(SHOTS, { recursive: true });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${locale}-${name}.png`), fullPage: !phone });
    };
    await open(page, locale);
    const shell = page.getByTestId("studio-shell");
    await expect(shell).toHaveAttribute("data-step", "idea");

    const cardEl = page.getByTestId("studio-idea-summary");
    await expect(cardEl).toHaveAttribute("data-state", "draft");

    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await typeWhenHydrated(input, PLANT[locale]);
    await input.press("Enter");

    // Immediately: the typing dots, and the card rows the words already tell us.
    await expect(page.getByTestId("studio-typing")).toBeVisible();
    await expect(row(page, "place")).toHaveAttribute("data-known", "1");
    await expect(row(page, "place")).toContainText(msg(locale, "Studio", "fact_place_plant_soil"));
    await expect(row(page, "does_0")).toContainText(msg(locale, "Studio", "fact_out_pump"));

    // One tap answers the question; the spec completes the card.
    const choices = page.getByTestId("studio-choices");
    await expect(choices).toBeVisible();
    await choices.getByRole("button").first().click();
    await expect(cardEl).toHaveAttribute("data-state", "spec");
    await expect(cardEl).toContainText(msg(locale, "Studio", "fact_out_pump"));
    await expect(cardEl).toContainText(msg(locale, "Studio", "fact_place_plant_soil"));
    await expect(cardEl).toContainText(msg(locale, "Studio", "fact_power_usb"));
    await expect(cardEl).not.toContainText(msg(locale, "Studio", "fact_use_desk"));

    // Layout: desktop = chat at the start, card at the end (mirrored in Arabic); phone = card above.
    const cardBox = await page.getByTestId("studio-idea-card-col").boundingBox();
    const chatBox = await page.getByTestId("studio-idea-chat").boundingBox();
    if (!cardBox || !chatBox) throw new Error("layout boxes missing");
    if (phone) {
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(chatBox.y + 1);
      await expect(page.getByTestId("studio-idea-card-toggle")).toBeVisible();
      await expect(page.getByTestId("studio-idea-card-toggle")).toHaveAttribute("aria-expanded", "true");
    } else if (locale === "en") {
      expect(cardBox.x).toBeGreaterThan(chatBox.x + chatBox.width - 1);
    } else {
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(chatBox.x + 1);
    }
    await expectNoHorizontalOverflow(page);
    // The chat never disappears with the card.
    await expect(page.getByRole("textbox", { name: card(locale, "refinePlaceholder") })).toBeVisible();
    await shot("1-card");

    // Next → parts: the pump is in the list.
    await page.getByRole("button", { name: msg(locale, "Studio", "looksRight") }).click();
    await expect(shell).toHaveAttribute("data-step", "parts");
    const parts = page.getByTestId("studio-parts-list");
    await expect(parts.locator("li").first()).toBeVisible();
    await expect(parts).toContainText(locale === "en" ? "Small water pump" : "مضخة ماء صغيرة");

    // Back to the idea: the chat is still usable and refines the card.
    const progress = page.getByRole("navigation", { name: msg(locale, "Studio", "progressLabel") });
    await progress.getByRole("button").filter({ hasText: msg(locale, "Studio", "step_idea") }).first().click();
    await expect(shell).toHaveAttribute("data-step", "idea");
    await expect(page.getByRole("button", { name: msg(locale, "Studio", "looksRight") })).toBeVisible();
    const refine = page.getByRole("textbox", { name: card(locale, "refinePlaceholder") });
    await typeWhenHydrated(refine, SOLAR[locale]);
    await refine.press("Enter");
    // Part A: a real reply + the "updated" chip naming the change.
    const chip = page.getByTestId("studio-idea-updated");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(card(locale, "updatedChip"));
    await expect(chip).toContainText(SOLAR_CHANGED[locale]);
    await expect(cardEl).toContainText(msg(locale, "Studio", "fact_power_battery_usb"));
    await expect(row(page, "power")).toHaveAttribute("data-fresh", "1");
    // Parts were picked for the old card: ONE button, "Update my parts", nothing redone yet.
    const update = page.getByRole("button", { name: card(locale, "updateParts") });
    await expect(update).toBeVisible();
    await expect(page.getByRole("button", { name: msg(locale, "Studio", "looksRight") })).toHaveCount(0);
    await expect(page.getByTestId("studio-update-parts-note")).toBeVisible();
    await shot("2-refined");
    await update.click();
    await expect(shell).toHaveAttribute("data-step", "parts");
    await expect(parts.locator("li").first()).toBeVisible();
  });

  test(`idea W3: a vague idea gets one question with chips, not an echo [${locale}]`, async ({ page }, info) => {
    await open(page, locale);
    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await typeWhenHydrated(input, VAGUE[locale]);
    await input.press("Enter");
    const log = page.getByRole("log");
    await expect(log.getByText(VAGUE_Q[locale])).toBeVisible();
    const chips = page.getByTestId("studio-choices").getByRole("button");
    await expect(chips).toHaveCount(4);
    // No spec was made from the vague words.
    await expect(page.getByTestId("studio-idea-summary")).toHaveAttribute("data-state", "draft");
    await expect(page.getByRole("button", { name: msg(locale, "Studio", "looksRight") })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `${info.project.name}-${locale}-3-vague.png`) });
    // A chip carries on: the plant chip asks the usual question, the card already knows the pump.
    await chips.first().click();
    await expect(page.getByTestId("studio-idea-facts").locator('[data-row="does_0"]')).toContainText(
      msg(locale, "Studio", "fact_out_pump"),
    );
  });
}

// Part A — once the card exists the chat answers like a person (mocked API: the
// fixture's mock answers a question with a canned reply and applies changes
// through the same guards as the server).
for (const locale of LOCALES) {
  test(`idea Part A: a question gets an answer and leaves the card alone; a change shows the chip [${locale}]`, async ({ page }) => {
    test.setTimeout(90_000);
    await open(page, locale);
    const cardEl = page.getByTestId("studio-idea-summary");
    const input = page.getByRole("textbox", { name: msg(locale, "Studio", "ideaPlaceholder") });
    await typeWhenHydrated(input, PLANT[locale]);
    await input.press("Enter");
    await page.getByTestId("studio-choices").getByRole("button").first().click();
    await expect(cardEl).toHaveAttribute("data-state", "spec");
    const before = await page.getByTestId("studio-idea-facts").innerText();

    // A question: an answer bubble, the card unchanged, no "updated" chip.
    const refine = page.getByRole("textbox", { name: card(locale, "refinePlaceholder") });
    await typeWhenHydrated(refine, QUESTION_TEXT[locale]);
    await refine.press("Enter");
    const replies = page.getByTestId("studio-idea-reply");
    await expect(replies.last()).toContainText(QUESTION_ANSWER[locale]);
    await expect(page.getByTestId("studio-idea-updated")).toHaveCount(0);
    expect(await page.getByTestId("studio-idea-facts").innerText()).toBe(before);
    await expect(page.getByRole("log")).not.toContainText("Done. Your card is updated.");

    // A greeting: the canned reply, no AI, no chip.
    await typeWhenHydrated(refine, locale === "en" ? "hi" : "مرحبا");
    await refine.press("Enter");
    await expect(replies).toHaveCount(2);
    await expect(page.getByTestId("studio-idea-updated")).toHaveCount(0);

    // A change: the chip lists what changed and the card updates.
    await typeWhenHydrated(refine, SOLAR[locale]);
    await refine.press("Enter");
    const chip = page.getByTestId("studio-idea-updated");
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText(SOLAR_CHANGED[locale]);
    await expect(cardEl).toContainText(msg(locale, "Studio", "fact_power_battery_usb"));
    await expectNoHorizontalOverflow(page);
  });
}
