import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, expectNoHorizontalOverflow, msg, test } from "./fixtures";

// The owner's dashboard (home tiles + stock lists) on the TEST-ONLY route
// /{locale}/e2e-fixtures/dashboard with static sample data: the real pages need a
// super_admin session, which this read-only suite never creates. Phone pictures
// for the owner: test-results/studio-final/dash-*.png (375 × 812, EN).

const FINAL = path.resolve(__dirname, "..", "test-results", "studio-final");

test("dashboard fixture: home tiles and stock lists", async ({ page }, info) => {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("gestaltung:cookie-consent", `declined.${Date.now()}`);
    } catch {
      /* storage blocked */
    }
  });
  const phone = info.project.name === "mobile-375";
  if (phone) mkdirSync(FINAL, { recursive: true });

  const res = await page.goto("/en/e2e-fixtures/dashboard");
  expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
  const home = page.getByTestId("fixture-dashboard-home");
  await expect(home.getByRole("heading", { level: 1, name: msg("en", "AdminHome", "title") })).toBeVisible();
  for (const key of ["reply", "confirm", "buy", "fix"]) {
    await expect(home.getByRole("heading", { level: 2, name: msg("en", "AdminHome", `${key}Title`) })).toBeVisible();
  }
  await expectNoHorizontalOverflow(page);
  if (phone) await page.screenshot({ path: path.join(FINAL, "dash-1-home.png") });

  await page.goto("/en/e2e-fixtures/dashboard?view=stock");
  const stock = page.getByTestId("fixture-dashboard-stock");
  await expect(stock.getByRole("heading", { level: 1, name: msg("en", "AdminStock", "title") })).toBeVisible();
  await expect(stock.getByText("Arduino Uno R3 board")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  if (phone) await page.screenshot({ path: path.join(FINAL, "dash-2-stock.png") });
});
