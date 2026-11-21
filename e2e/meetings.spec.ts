import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// Paid engineer meetings (migration 0113): the client's manage card in both
// states and the website booking form. Rendered on the TEST-ONLY route
// /{locale}/e2e-fixtures/meetings (lib/e2e-fixtures.ts: needs E2E_FIXTURES=1,
// never reachable on Vercel). The only network call the booking form makes is
// GET /api/meetings/slots, intercepted below, so nothing here writes — and the
// `guard` fixture fails the test if anything tries.

const WIDTHS = [375, 1366];

const SLOTS = {
  slots: [
    { starts_at: "2026-11-23T13:00:00.000Z", label_en: "Mon 23 Nov · 4:00 pm", label_ar: "الاثنين 23 نوفمبر · 4:00 م" },
    { starts_at: "2026-11-25T13:00:00.000Z", label_en: "Wed 25 Nov · 4:00 pm", label_ar: "الأربعاء 25 نوفمبر · 4:00 م" },
  ],
  price_qar: 150,
  lines: [
    "1 hour · QAR 150",
    "Invoiced after the meeting, only if you are happy.",
    "Free to move or cancel up to 24 hours before. Counts towards an order within 30 days.",
  ],
  modes: [
    { mode: "online", label: "Online", detail: "Online: we send the meeting link on WhatsApp before the meeting." },
    { mode: "studio", label: "At the studio", detail: "At the studio: Rafal Tower, Lusail, Qatar" },
  ],
  company: "Gestaltung for Trading and Services W.L.L · C.R. 236988",
};

for (const locale of LOCALES) {
  for (const width of WIDTHS) {
    test(`meeting manage card and booking form [${locale} ${width}px]`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.route("**/api/meetings/slots**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SLOTS) }),
      );

      const res = await page.goto(`/${locale}/e2e-fixtures/meetings`);
      expect(res?.status(), "start the server with E2E_FIXTURES=1 (playwright.config.ts webServer.env)").toBe(200);
      await expectLocale(page, locale);

      const cards = page.locator('[data-testid="meeting-card"]');
      await expect(cards).toHaveCount(2);
      const open = cards.first();
      const tooLate = cards.nth(1);

      // Inside the 24-hour window: the time, the three rules and both buttons.
      await expect(open).toContainText("Mon 23 Nov");
      await expect(open).toContainText(msg(locale, "Meetings", "statusBooked"));
      await expect(open.getByTestId("meeting-rules")).toContainText("QAR 150");
      await expect(open.getByTestId("meeting-move-open")).toHaveText(msg(locale, "Meetings", "move"));
      await expect(open.getByTestId("meeting-cancel-open")).toHaveText(msg(locale, "Meetings", "cancel"));
      // The company's legal name and C.R. are on every card that books.
      await expect(open).toContainText("236988");

      // Move opens a slot picker; Keep closes it again. No action is submitted.
      await open.getByTestId("meeting-move-open").click();
      await expect(open.getByTestId("meeting-move-slot")).toBeVisible();
      await expect(open.getByTestId("meeting-move")).toContainText(msg(locale, "Meetings", "moveTitle"));
      await open.getByRole("button", { name: msg(locale, "Meetings", "keep") }).click();
      await expect(open.getByTestId("meeting-move-slot")).toBeHidden();

      // Cancel asks first.
      await open.getByTestId("meeting-cancel-open").click();
      await expect(open.getByTestId("meeting-cancel-confirm")).toContainText(msg(locale, "Meetings", "cancelTitle"));
      await open.getByRole("button", { name: msg(locale, "Meetings", "keep") }).click();
      await expect(open.getByTestId("meeting-cancel-confirm")).toBeHidden();

      // Past the window: the WhatsApp line instead of the buttons.
      await expect(tooLate.getByTestId("meeting-too-late")).toContainText(msg(locale, "Meetings", "tooLate"));
      await expect(tooLate.getByRole("link", { name: msg(locale, "Meetings", "whatsapp") })).toBeVisible();
      await expect(tooLate.getByTestId("meeting-move-open")).toHaveCount(0);
      await expect(tooLate.getByTestId("meeting-cancel-open")).toHaveCount(0);

      // The booking form: the rules, a slot list, both modes and the fields.
      const form = page.getByTestId("meeting-booking");
      await expect(form.getByTestId("meeting-rules")).toContainText("QAR 150");
      await expect(form.getByTestId("meeting-slot")).toBeVisible();
      await expect(form.getByTestId("meeting-slot").locator("option")).toHaveCount(2);
      await expect(form.getByTestId("meeting-slot")).toContainText(locale === "ar" ? "نوفمبر" : "Nov");
      await expect(form.getByRole("radio", { name: /Online/ })).toBeVisible();
      await expect(form.getByRole("button", { name: msg(locale, "Meetings", "submit") })).toBeVisible();

      // Submitting with nothing filled in is refused in the browser: no POST.
      await form.getByRole("button", { name: msg(locale, "Meetings", "submit") }).click();
      await expect(form.getByTestId("meeting-error")).toContainText(msg(locale, "Meetings", "required"));

      await expectNoHorizontalOverflow(page);
    });

    test(`booking form says so when there are no free times [${locale} ${width}px]`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1100 });
      await page.route("**/api/meetings/slots**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...SLOTS, slots: [] }) }),
      );
      await page.goto(`/${locale}/e2e-fixtures/meetings`);
      await expect(page.getByTestId("meeting-no-times")).toContainText(msg(locale, "Meetings", "noTimes"));
      await expectNoHorizontalOverflow(page);
    });
  }

  test(`an unknown manage token shows the not-found message, no write [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/meetings/not-a-valid-token!!`);
    await expectLocale(page, locale);
    await expect(page.locator('[data-testid="meeting-card"][data-state="notFound"]')).toContainText(
      msg(locale, "Meetings", "notFound"),
    );
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
}
