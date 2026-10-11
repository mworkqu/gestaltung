import { expect, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// D1 Fix list on the TEST-ONLY route /{locale}/e2e-fixtures/dashboard-fix with
// static sample rows (the real page needs a super_admin session, which this
// read-only suite never creates). Checks grouping by reason + supplier, the
// plain "why", group selection + the bulk bar's confirm step, and the drawer
// showing only the missing fields. Nothing is confirmed or saved.

for (const locale of LOCALES) {
  test(`fix list fixture (${locale}): groups, bulk bar, drawer`, async ({ page }) => {
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
      } catch {
        /* storage blocked */
      }
    });
    const m = (key: string) => msg(locale, "FixList", key);

    const res = await page.goto(`/${locale}/e2e-fixtures/dashboard-fix`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
    const root = page.getByTestId("fixture-dashboard-fix");

    // One heading per issue, in order, with counts.
    const headings = root.getByRole("heading", { level: 2 });
    await expect(headings).toHaveText([m("issue_delivery"), m("issue_photo"), m("issue_price"), m("issue_supplier")]);
    const delivery = root.locator("section", { has: page.getByRole("heading", { level: 2, name: m("issue_delivery") }) });
    await expect(delivery.getByText("4", { exact: true }).first()).toBeVisible();

    // Supplier sub-groups inside Delivery date + the plain why.
    await expect(delivery.getByRole("heading", { level: 3, name: new RegExp(m("bucket_voltaat")) })).toBeVisible();
    await expect(delivery.getByRole("heading", { level: 3, name: new RegExp(m("bucket_none")) })).toBeVisible();
    await expect(delivery.getByText(m("why_noOffer"))).toBeVisible();

    // Select all in the group → bottom bar → Set delivery time → confirm step → back.
    await delivery.getByLabel(m("selectAllGroup")).check();
    await expect(page.getByText(m("selected").replace("{count}", "4"))).toBeVisible();
    await page.getByRole("button", { name: m("actionDelivery") }).click();
    await expect(page.getByRole("combobox").first()).toBeVisible();
    await page.getByRole("button", { name: m("next") }).click();
    await expect(page.getByRole("button", { name: m("confirm") })).toBeVisible();
    await page.getByRole("button", { name: m("back") }).click();
    await page.getByRole("button", { name: m("back") }).click();
    await page.getByRole("button", { name: m("clear") }).click();
    await expect(page.getByRole("button", { name: m("actionDelivery") })).toHaveCount(0);

    await expectNoHorizontalOverflow(page);

    // Drawer: the price-only product shows only the price field.
    await root.getByRole("button", { name: /Active buzzer 5 V/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(m("addThis"))).toHaveCount(1);
    await expect(dialog.getByRole("textbox")).toHaveCount(1);
    await expect(dialog.getByText(m("priceHint"))).toBeVisible();
    await expect(dialog.getByRole("link", { name: m("fullEdit") })).toHaveAttribute("href", /returnTo=/);
    await dialog.getByRole("button", { name: m("close") }).click();
    await expect(dialog).toBeHidden();

    // Drawer for a delivery gap shows the offer mini-form first.
    await root.getByRole("button", { name: /Jumper wires/ }).first().click();
    await expect(page.getByRole("dialog").getByLabel(m("leadDaysLabel"))).toBeVisible();
  });
}
