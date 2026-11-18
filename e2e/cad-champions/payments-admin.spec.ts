import { FX } from "../../app/[locale]/cad-champions/e2e-fixtures/[fixture]/fixture-data";

import { cc, expect, fixtureUrl, layoutOk, LOCALES, openFixture, PNG_1X1, test } from "./cc";

// Join -> checkout -> Fawran proof form (mocked "send"), the admin approving
// that payment (ConfirmDialog), and the trainer review on the 0-3 judgement
// scale with the finalize confirmation. All actions mocked.

const fill = (text: string, vars: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? `{${k}}`);

for (const locale of LOCALES) {
  test.describe(`payments + admin (${locale})`, () => {
    test("join: choose plan and cohort, reserve, pay with Fawran, send the proof", async ({ page, actions }) => {
      actions.on((args) => {
        const input = args?.[0] as Record<string, unknown> | undefined;
        if (input?.planSlug === "e2e-online") return { ok: true, paymentId: FX.paymentId, redirectUrl: fixtureUrl(locale, "fawran") };
        if (input && typeof input.proofPath === "string") return { ok: true };
        return undefined;
      });
      await openFixture(page, locale, "checkout");
      await expect(page.getByRole("heading", { name: cc(locale, "payments", "checkout.planTitle") })).toBeVisible();
      await layoutOk(page);
      await page.getByRole("button", { name: /Online training \(sample\)/ }).click();
      await expect(page.getByRole("heading", { name: cc(locale, "payments", "checkout.cohortTitle") })).toBeVisible();
      await page.getByRole("radio").first().check();
      await page.getByRole("button", { name: cc(locale, "payments", "checkout.next"), exact: true }).click();
      await page.getByRole("checkbox").check();
      await layoutOk(page);
      await page.getByRole("button", { name: cc(locale, "payments", "checkout.submit") }).click();

      // createCheckoutAction answered with the Fawran fixture as the next page.
      await page.waitForURL(`**${fixtureUrl(locale, "fawran")}`);
      await expect(page.getByTestId("cc-fixture-fawran")).toBeVisible();
      await expect(page.getByRole("heading", { name: cc(locale, "payments", "pay.doneTitle") })).toBeVisible();
      await expect(page.getByText("CC-E2E-0001").first()).toBeVisible();
      await layoutOk(page);

      await page.getByLabel(cc(locale, "payments", "proof.payerName"), { exact: true }).fill("Sample Payer");
      await page.getByLabel(cc(locale, "payments", "proof.bank"), { exact: true }).selectOption({ index: 1 });
      await page.getByLabel(cc(locale, "payments", "proof.reference"), { exact: true }).fill("TRX-0001");
      await page.locator('input[type="file"][accept*=".png"]').setInputFiles({ name: "transfer.png", mimeType: "image/png", buffer: PNG_1X1 });
      await expect(page.getByText("transfer.png")).toBeVisible();
      await page.getByRole("button", { name: cc(locale, "payments", "proof.submit") }).click();
      const dialog = page.getByRole("dialog", { name: cc(locale, "payments", "proof.confirmTitle") });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: cc(locale, "payments", "proof.confirmButton") }).click();
      await expect(page.getByText(cc(locale, "payments", "proof.sent"), { exact: true }).first()).toBeVisible();

      const proof = actions.calls.at(-1)?.args?.[0] as Record<string, unknown>;
      expect(proof).toMatchObject({ paymentId: FX.paymentId, payerName: "Sample Payer", transferReference: "TRX-0001" });
      expect(String(proof.proofPath)).toContain("transfer.png");
    });

    test("admin payments: approve asks first, then confirms", async ({ page, actions }) => {
      actions.on((args) => ((args?.[0] as Record<string, unknown> | undefined)?.paymentId === FX.paymentId ? { ok: true } : undefined));
      await openFixture(page, locale, "payments");
      await layoutOk(page);
      await page.getByRole("button", { name: cc(locale, "payments", "admin.approve"), exact: true }).click();
      const dialog = page.getByRole("dialog", { name: cc(locale, "payments", "admin.approveTitle") });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("CC-E2E-0001");
      expect(actions.calls).toHaveLength(0);
      await dialog.getByRole("button", { name: cc(locale, "payments", "admin.approveConfirm") }).click();
      await expect(page.getByText(cc(locale, "payments", "admin.approved"), { exact: true }).first()).toBeVisible();
      expect(actions.calls.map((c) => c.args)).toEqual([[{ paymentId: FX.paymentId }]]);
    });

    test("admin review: pass/fail + 0-3 judgement, finalize asks first", async ({ page, actions }) => {
      actions.on((args) => {
        const input = args?.[0] as Record<string, unknown> | undefined;
        if (input?.taskResultId === FX.reviewId && Array.isArray(input.decisions))
          return { ok: true, attemptId: FX.attemptId, finalScore: 8, maxPoints: 10, attemptStatus: "graded", emailed: true };
        return undefined;
      });
      await openFixture(page, locale, "review");
      await layoutOk(page);
      const decide = (item: string) => fill(cc(locale, "review", "screen.rubric.decide"), { item });

      const measurement = page.getByRole("group", { name: decide("Projection symbol present") });
      await measurement.getByRole("button", { name: cc(locale, "review", "screen.rubric.pass"), exact: true }).click();
      await expect(measurement.getByRole("button", { name: cc(locale, "review", "screen.rubric.pass"), exact: true })).toHaveAttribute("aria-pressed", "true");

      const judgement = page.getByRole("radiogroup", { name: decide("Drawing layout and presentation") });
      await expect(judgement.getByRole("radio")).toHaveCount(4);
      for (const s of [0, 1, 2, 3]) await expect(judgement.getByRole("radio").nth(s)).toContainText(cc(locale, "review", `screen.rubric.scale.${s}`));
      await judgement.getByRole("radio").nth(2).click();
      await expect(judgement.getByRole("radio").nth(2)).toHaveAttribute("aria-checked", "true");
      // max 6 points, score 2 of 3 -> 4 points
      await expect(judgement).toContainText(fill(cc(locale, "review", "screen.rubric.earned"), { points: "4", max: "6" }));
      await expect(page.getByText(cc(locale, "review", "screen.finalize.ready"))).toBeVisible();

      await page.getByRole("button", { name: cc(locale, "review", "screen.finalize.button"), exact: true }).click();
      const dialog = page.getByRole("dialog", { name: cc(locale, "review", "screen.finalize.confirmTitle") });
      await expect(dialog).toBeVisible();
      expect(actions.calls).toHaveLength(0);
      await dialog.getByRole("button", { name: cc(locale, "review", "screen.finalize.button"), exact: true }).click();
      await expect(page.getByText(cc(locale, "review", "screen.finalize.doneTitle"), { exact: true })).toBeVisible();

      const sent = actions.calls[0].args?.[0] as { decisions: { aspectId: string; passed?: boolean; score?: number }[] };
      expect(sent.decisions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ aspectId: "00000000-0000-4000-8000-000000000a11", passed: true }),
          expect.objectContaining({ aspectId: "00000000-0000-4000-8000-000000000a12", score: 2 }),
        ]),
      );
      await layoutOk(page);
    });
  });
}
