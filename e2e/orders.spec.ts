import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// Path 5 (read-only half): /orders without a session redirects to sign-in
// (app/[locale]/orders/page.tsx). The signed-in view needs a real test account
// and is a manual pass (docs/CUTOVER.md).
for (const locale of LOCALES) {
  test(`orders without a session goes to sign-in [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/orders`);
    await page.waitForURL("**/sign-in**");
    expect(page.url()).toContain("/sign-in");
    expect(new URL(page.url()).pathname.startsWith(`/${locale}/`)).toBe(true);
    await expectLocale(page, locale);
    await expect(page.locator("form").first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}

// ── Owner order list (D3) ───────────────────────────────────────────────────
// The real page needs a super_admin session, which this read-only suite never
// creates, so the table is checked on the TEST-ONLY fixture route
// /{locale}/e2e-fixtures/orders with static sample orders (start the server
// with E2E_FIXTURES=1; playwright.config.ts does). Hints open on hover
// (desktop), tap (phone) and keyboard focus; Escape closes. Nothing is clicked
// that writes.
const STATUS_ROWS: [string, string][] = [
  ["aaaa0001", "confirmed"],
  ["aaaa0002", "paid"],
  ["aaaa0003", "sourcing"],
  ["aaaa0004", "shipped"],
  ["aaaa0005", "delivered"],
  ["aaaa0006", "cancelled"],
];

for (const locale of LOCALES) {
  test(`owner orders: every status pill has a hint [${locale}]`, async ({ page }, info) => {
    const res = await page.goto(`/${locale}/e2e-fixtures/orders`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    await expectLocale(page, locale);
    const phone = info.project.name === "mobile-375";

    for (const [id, status] of STATUS_ROWS) {
      const row = page.getByTestId(`order-row-${id}`);
      const pill = row.locator("span[tabindex='0']").first();
      const hint = msg(locale, "OrdersAdmin", `hint_${status}`);
      if (phone) await pill.tap();
      else await pill.hover();
      await expect(page.getByRole("tooltip")).toHaveText(hint);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toHaveCount(0);
    }

    // Keyboard: focus opens, Escape closes, and the pill is described by the bubble.
    const pill = page.getByTestId("fixture-lone-pill").locator("span[tabindex='0']");
    await pill.focus();
    await expect(page.getByRole("tooltip")).toHaveText(msg(locale, "OrdersAdmin", "hint_paid"));
    await expect(pill).toHaveAttribute("aria-describedby", /.+/);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test(`owner orders: column hints, WhatsApp column and next-step buttons [${locale}]`, async ({ page }, info) => {
    await page.goto(`/${locale}/e2e-fixtures/orders`);
    const phone = info.project.name === "mobile-375";
    const table = page.getByTestId("orders-table");

    // The renamed WhatsApp column: label + tooltip.
    const waHeader = table.locator("th").last();
    await expect(waHeader).toContainText(msg(locale, "OrdersAdmin", "col_whatsapp"));
    const dot = waHeader.getByRole("button");
    if (phone) await dot.tap();
    else await dot.hover();
    await expect(page.getByRole("tooltip")).toHaveText(msg(locale, "OrdersAdmin", "col_whatsapp_hint"));
    await page.keyboard.press("Escape");

    // Every header has a hint dot.
    expect(await table.locator("thead th").count()).toBe(10);
    expect(await table.locator("thead th").getByRole("button").count()).toBe(10);

    // Next step per order: Paid names the supplier of its lines.
    const paid = page.getByTestId("order-row-aaaa0002");
    await expect(paid.getByRole("button", { name: locale === "en" ? "Start sourcing from Voltaat" : /Voltaat/ })).toBeVisible();
    await expect(page.getByTestId("order-row-aaaa0001").getByRole("button", { name: msg(locale, "OrdersAdmin", "next_mark_paid") })).toBeVisible();
    await expect(page.getByTestId("order-row-aaaa0005")).toContainText(msg(locale, "OrdersAdmin", "next_done"));
    await expect(page.getByTestId("order-row-aaaa0006")).toContainText(msg(locale, "OrdersAdmin", "badge_test"));
  });
}
