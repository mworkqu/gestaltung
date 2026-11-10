import { cc, expect, layoutOk, LOCALES, openFixture, STEP_TEXT, test } from "./cc";

// Results variants (radar, band, provisional chip, module readiness, expired),
// the free lesson (open) vs a paid one (locked), and an L1 exercise: hints
// open after failed attempts, a mocked pass, the certificate link.

const BANDS: Record<string, string> = { weak: "beginner", medium: "developing", strong: "competition_ready" };

for (const locale of LOCALES) {
  test.describe(`results + training (${locale})`, () => {
    test("results: weak / medium / strong / provisional / expired", async ({ page }) => {
      for (const variant of ["weak", "medium", "strong", "provisional"]) {
        await openFixture(page, locale, "results", `?variant=${variant}`);
        await expect(page.getByRole("img", { name: cc(locale, "results", "skillMap.chartLabel") })).toBeVisible();
        await expect(page.getByRole("heading", { name: cc(locale, "results", "modules.title") })).toBeVisible();
        const chip = variant === "provisional" ? "header.provisional" : "header.final";
        await expect(page.getByText(cc(locale, "results", chip), { exact: true })).toBeVisible();
        const band = BANDS[variant];
        if (band) await expect(page.getByText(cc(locale, "results", `band.${band}.name`), { exact: true })).toBeVisible();
        await layoutOk(page);
      }
      await openFixture(page, locale, "results", "?variant=expired");
      await expect(page.getByRole("heading", { name: cc(locale, "results", "states.expiredTitle") })).toBeVisible();
      await expect(page.getByRole("img", { name: cc(locale, "results", "skillMap.chartLabel") })).toHaveCount(0);
      await layoutOk(page);
    });

    test("free lesson opens, a paid lesson stays locked", async ({ page }) => {
      await openFixture(page, locale, "lesson");
      await expect(page.getByText(cc(locale, "training", "common.freePreview"), { exact: true })).toBeVisible();
      await expect(page.getByTestId("lesson-free").getByText(cc(locale, "training", "lesson.lockedTitle"))).toHaveCount(0);
      await expect(page.getByTestId("lesson-paid").getByText(cc(locale, "training", "lesson.lockedTitle"))).toBeVisible();
      await layoutOk(page);
    });

    test("exercise: hints follow failed attempts, then a pass earns the certificate", async ({ page, actions }) => {
      const reveal = (n: number) => cc(locale, "training", "hints.reveal").replace("{n}", String(n));

      await openFixture(page, locale, "exercise", "?attempts=0");
      await expect(page.getByRole("button", { name: reveal(1) })).toHaveCount(0);
      await layoutOk(page);

      await openFixture(page, locale, "exercise", "?attempts=2");
      await expect(page.getByRole("button", { name: reveal(1) })).toBeVisible();
      await expect(page.getByRole("button", { name: reveal(2) })).toBeVisible();
      await expect(page.getByRole("button", { name: reveal(3) })).toHaveCount(0);

      actions.on((args) => {
        const input = args?.[0] as Record<string, unknown> | undefined;
        if (input && typeof input.n === "number") return { ok: true, text: `Sample hint ${input.n}: check the hole spacing.` };
        if (input && typeof input.path === "string")
          return {
            ok: true,
            outcome: "passed",
            attemptId: null,
            percent: 92,
            best: 92,
            passMark: 80,
            message: null,
            helpSlug: null,
            checks: [
              { name: "volume", passed: true },
              { name: "surface_area", passed: true },
            ],
            hintsAvailable: 2,
            solutionUnlocked: true,
            xpGained: 50,
            newBadges: 0,
            certificateCode: "CC-E2E-CERT",
          };
        return undefined;
      });
      await page.getByRole("button", { name: reveal(1) }).click();
      await expect(page.getByText("Sample hint 1: check the hole spacing.")).toBeVisible();

      await page.locator('input[type="file"][accept=".step,.stp"]').setInputFiles({ name: "bracket.step", mimeType: "application/step", buffer: Buffer.from(STEP_TEXT) });
      const passed = page.getByRole("status").filter({ hasText: cc(locale, "training", "exercise.passedTitle").split("{")[0].trim() });
      await expect(passed.first()).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(cc(locale, "training", "exercise.certificateEarned").slice(0, 12)) })).toHaveAttribute(
        "href",
        `/cad-champions/${locale}/training/certificates/CC-E2E-CERT`,
      );
      await layoutOk(page);
    });
  });
}
