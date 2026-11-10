import { GET_READY_ALMOST_DONE } from "../../app/[locale]/cad-champions/e2e-fixtures/[fixture]/fixture-data";

import { cc, expect, layoutOk, LOCALES, openFixture, STEP_TEXT, test } from "./cc";

// Student journey before the test: dashboard (next step + tracker for each
// journey state), onboarding screens, Get Ready (practice upload passes ->
// "You're ready"). Fixtures with mocked actions; nothing is saved.

const DASHBOARD: { state: string; step: string; reason: string; current: string | null }[] = [
  { state: "new", step: "complete_profile", reason: "complete_profile", current: null },
  { state: "ready", step: "take_test", reason: "take_test", current: "free_test" },
  { state: "testing", step: "take_test", reason: "take_test_resume", current: "free_test" },
  { state: "results", step: "view_results", reason: "view_results", current: "results" },
  { state: "enrolled", step: "continue_training", reason: "continue_training", current: "training" },
];

for (const locale of LOCALES) {
  test.describe(`journey (${locale})`, () => {
    test("dashboard: next step and tracker follow the journey", async ({ page }) => {
      for (const d of DASHBOARD) {
        await openFixture(page, locale, "dashboard", `?state=${d.state}`);
        const next = page.getByTestId("next-step");
        await expect(next).toHaveAttribute("data-step", d.step);
        await expect(next).toContainText(cc(locale, "dashboard", `nextStep.reason.${d.reason}`));
        const tracker = page.getByTestId("tracker");
        await expect(tracker.getByRole("heading", { name: cc(locale, "dashboard", "tracker.title") })).toBeVisible();
        if (d.current) await expect(tracker.locator('[aria-current="step"]')).toContainText(cc(locale, "dashboard", `tracker.steps.${d.current}.label`));
        await layoutOk(page);
      }
    });

    test("onboarding: walk every screen to Get Ready", async ({ page, actions }) => {
      actions.on((args) => {
        // saveOnboardingStep(n) and completeOnboarding(track)
        if (args && (typeof args[0] === "number" || args[0] === "inventor")) return { ok: true };
        return undefined;
      });
      await openFixture(page, locale, "onboarding");
      const heading = page.locator("#cc-onboarding-heading");
      await expect(heading).toHaveText(cc(locale, "onboarding", "what.title"));
      await layoutOk(page);
      await page.getByRole("button", { name: cc(locale, "onboarding", "next"), exact: true }).click();
      await expect(heading).toHaveText(cc(locale, "onboarding", "how.title"));
      await page.getByRole("button", { name: cc(locale, "onboarding", "next"), exact: true }).click();
      await expect(heading).toHaveText(cc(locale, "onboarding", "before.title"));
      await page.getByRole("button", { name: cc(locale, "onboarding", "next"), exact: true }).click();
      await expect(heading).toHaveText(cc(locale, "onboarding", "software.title"));
      await layoutOk(page);
      await page.getByRole("button", { name: cc(locale, "onboarding", "goToGetReady") }).click();
      await page.waitForURL(/\/get-ready|\/sign-in/);
      expect(actions.calls.map((c) => c.args?.[0])).toEqual([1, 2, 3, "inventor"]);
    });

    test("get ready: steps listed, practice upload passes, celebration", async ({ page, actions }) => {
      await openFixture(page, locale, "get-ready");
      await expect(page.getByRole("list", { name: cc(locale, "get-ready", "list.label") })).toBeVisible();
      await expect(page.getByText(cc(locale, "get-ready", "steps.practice_upload.title"))).toBeVisible();
      await layoutOk(page);

      actions.on((args) =>
        typeof args?.[0] === "string" && String(args[0]).includes("/practice/")
          ? { ok: true, outcome: "passed", keys: [...GET_READY_ALMOST_DONE, "practice_upload"], complete: true, justCompleted: true, basicCheckOnly: false }
          : undefined,
      );
      await openFixture(page, locale, "get-ready", "?keys=practice");
      await expect(page.getByText(cc(locale, "get-ready", "practice.taskTitle"))).toBeVisible();
      await page.locator('input[type="file"][accept=".step,.stp"]').setInputFiles({ name: "practice.step", mimeType: "application/step", buffer: Buffer.from(STEP_TEXT) });
      // justCompleted closes the step and shows the celebration instead.
      await expect(page.getByRole("heading", { name: cc(locale, "get-ready", "celebration.title") })).toBeVisible();
      expect(actions.calls).toHaveLength(1);
      await layoutOk(page);
    });
  });
}
