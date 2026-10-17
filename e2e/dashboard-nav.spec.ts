import { expect, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// D2 dashboard sidebar on the TEST-ONLY route /{locale}/e2e-fixtures/dashboard?view=nav
// (real adminNavGroups, sample badges, a long page beside it): four groups,
// "Back to website" first, the sidebar scrolls on its own on a 1366 × 768
// screen. The real /dashboard needs a super_admin session, which this
// read-only suite never creates, so the old URLs are only checked to still
// answer (they send a visitor without a session to sign-in, never a 404).

const GROUPS = ["group_today", "group_sell", "group_build", "group_settings"];

const OLD_URLS = [
  "/dashboard",
  "/dashboard/overview",
  "/dashboard/leads",
  "/dashboard/store/orders",
  "/dashboard/projects",
  "/dashboard/credits",
  "/dashboard/reviews",
  "/dashboard/store/overview",
  "/dashboard/store",
  "/dashboard/store/quick",
  "/dashboard/store/attributes",
  "/dashboard/store/stock",
  "/dashboard/store/fix",
  "/dashboard/store/restock",
  "/dashboard/store/gaps",
  "/dashboard/store/occasions",
  "/dashboard/store/discounts",
  "/dashboard/store/youtube",
  "/dashboard/studio-library",
  "/dashboard/store/suppliers",
  "/dashboard/store/suppliers/lookup",
  "/dashboard/store/suppliers/voltaat",
  "/dashboard/usage",
  "/dashboard/notifications",
  "/dashboard/contact",
  "/inventory",
];

for (const locale of LOCALES) {
  test(`dashboard nav (${locale}): four groups, back to website first, scrolls at 1366x768`, async ({ page }, info) => {
    test.skip(info.project.name === "mobile-375", "desktop sidebar");
    await page.setViewportSize({ width: 1366, height: 768 });
    const res = await page.goto(`/${locale}/e2e-fixtures/dashboard?view=nav`);
    expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);

    const nav = page.getByTestId("dashboard-sidebar");
    await expect(nav).toBeVisible();

    // "Back to website" is the first link.
    const first = nav.getByRole("link").first();
    await expect(first).toHaveText(msg(locale, "DashboardNav", "backToSite"));
    await expect(first).toHaveAttribute("href", new RegExp(`^/${locale}/?$`));

    for (const g of GROUPS) await expect(nav.getByText(msg(locale, "DashboardNav", g), { exact: true })).toBeVisible();

    // Badges: something to do shows a number, nothing to do shows none.
    await expect(nav.getByRole("link", { name: new RegExp(msg(locale, "DashboardNav", "fixList")) })).toContainText("14");

    // The sidebar fits the screen and scrolls by itself.
    const box = await nav.evaluate((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { overflowY: s.overflowY, bottom: r.bottom, scrollH: el.scrollHeight, clientH: el.clientHeight };
    });
    expect(box.overflowY).toBe("auto");
    expect(box.bottom).toBeLessThanOrEqual(768);
    expect(box.scrollH).toBeGreaterThanOrEqual(box.clientH);

    // The last item can be reached inside the sidebar and stays visible while the page scrolls.
    const last = nav.getByRole("link", { name: msg(locale, "DashboardNav", "inventory") });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await page.mouse.wheel(0, 2000);
    await expect(nav).toBeInViewport();

    await expectNoHorizontalOverflow(page);
  });
}

test("dashboard nav (phone): back to website at the top of the menu", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-375", "phone menu");
  await page.goto("/en/e2e-fixtures/dashboard?view=nav");
  await page.getByTestId("fixture-dashboard-nav").getByRole("button", { expanded: false }).first().click();
  const drawer = page.getByRole("navigation", { name: msg("en", "DashboardNav", "navLabel") }).first();
  await expect(drawer.getByRole("link").first()).toHaveText(msg("en", "DashboardNav", "backToSite"));
  const overflowY = await drawer.evaluate((el) => getComputedStyle(el).overflowY);
  expect(overflowY).toBe("auto");
  await expectNoHorizontalOverflow(page);
});

test("old dashboard URLs still answer", async ({ request }, info) => {
  test.skip(info.project.name === "mobile-375", "once is enough");
  for (const url of OLD_URLS) {
    const res = await request.get(`/en${url}`);
    expect(res.status(), url).toBeLessThan(400);
    // Without a session every one ends on sign-in, never on the 404 page.
    expect(new URL(res.url()).pathname, url).toBe("/en/sign-in");
  }
});
