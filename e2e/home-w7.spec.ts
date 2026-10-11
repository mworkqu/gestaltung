import type { Page, Route } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// W7 home (read-only): hero poster -> live 3D (poster only with reduced
// motion), clickable founder cards, instant store search ("dc motor" shows a
// dropdown; arrows / Esc / Enter; Add to cart adds in place and the header
// badge updates). The add-to-cart writes are MOCKED with page.route (they take
// precedence over the write guard's context.route): the anonymous sign-in and
// the cart_items insert / reads never reach Supabase. Product data is the live
// catalogue, read through GET /api/store/search.

/**
 * The live home is the v2 page (site_v2 ON). The middleware reads that flag with a
 * 1.5 s timeout and falls back to the old v1 home when the read fails (it does under
 * a loaded test machine), so open /v2 with the preview cookie: flag ON → 308 to
 * /{locale} (v2), flag read failed → the cookie still serves v2.
 */
async function gotoHome(page: Page, locale: string, baseURL: string | undefined) {
  await page.context().addCookies([{ name: "site_v2", value: "1", url: baseURL ?? "http://localhost:3000" }]);
  await page.goto(`/${locale}/v2`);
  await expect(page.getByTestId("hero-enclosure")).toHaveCount(1);
}

const ANON_ID = "00000000-0000-4000-8000-0000000e2e07";

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Fake anonymous session + an in-memory cart_items table, so Add to cart runs end to end without a write. */
async function mockCartWrites(page: Page) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: ANON_ID, role: "authenticated", is_anonymous: true, exp })}.e2e`;
  const user = {
    id: ANON_ID,
    aud: "authenticated",
    role: "authenticated",
    is_anonymous: true,
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const rows: Record<string, unknown>[] = [];
  const posted: string[] = [];

  await page.route(/\/auth\/v1\/signup/, (route) =>
    route.fulfill({
      json: { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "e2e-refresh", user },
    }),
  );
  await page.route(/\/auth\/v1\/user/, (route) => route.fulfill({ json: user }));
  await page.route(/\/rest\/v1\/cart_items/, async (route: Route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}") as { product_id: string; quantity: number };
      posted.push(body.product_id);
      const part = await page.evaluate(
        (id) => (window as unknown as { __w7parts?: Record<string, unknown> }).__w7parts?.[id] ?? null,
        body.product_id,
      );
      rows.push({ id: `row-${rows.length + 1}`, quantity: body.quantity, project_id: null, kit_id: null, bom_lines: [], part, project: null });
      return route.fulfill({ status: 201, body: "" });
    }
    const url = new URL(req.url());
    // The add's lookup ("is this product already a loose line?") → no.
    if (url.searchParams.get("product_id")) return route.fulfill({ json: [] });
    return route.fulfill({ json: rows });
  });
  // Reads made with the fake token would be rejected by the real API: answer them empty.
  await page.route(/\/rest\/v1\/(store_settings|projects|part_orders|credits_ledger|profiles)/, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: [] }) : route.abort(),
  );
  await page.route(/\/rest\/v1\/rpc\//, (route) => route.fulfill({ json: null }));
  return { posted };
}

for (const locale of LOCALES) {
  test.describe(`home W7 [${locale}]`, () => {
    test("hero: poster first, a link to a new project, live 3D after interaction", async ({ page, baseURL }) => {
      await gotoHome(page, locale, baseURL);
      await expectLocale(page, locale);
      const hero = page.getByTestId("hero-enclosure");
      await expect(hero).toHaveAttribute("href", `/${locale}/projects/new`);
      const poster = hero.locator("img");
      await expect(poster).toHaveAttribute("fetchpriority", "high");
      await expect(poster).toHaveAttribute("src", /\/home\/hero-enclosure\.webp$/);
      // No 3D before the page has been used.
      await expect(hero.locator("canvas")).toHaveCount(0);
      await page.mouse.move(5, 5);
      await page.mouse.move(40, 40);
      await expect(hero.locator("canvas")).toHaveCount(1, { timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
    });

    test("hero: reduced motion keeps the poster only", async ({ page, baseURL }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await gotoHome(page, locale, baseURL);
      const hero = page.getByTestId("hero-enclosure");
      await expect(hero.locator("img")).toBeVisible();
      await page.mouse.move(5, 5);
      await page.mouse.move(40, 40);
      await page.waitForTimeout(6_500);
      await expect(hero.locator("canvas")).toHaveCount(0);
      await expect(hero).toHaveAttribute("data-live", "0");
    });

    test("founder cards are links: new project, store, WhatsApp", async ({ page, baseURL }) => {
      await gotoHome(page, locale, baseURL);
      const cards = page.getByTestId("founder-cards").locator("a");
      await expect(cards).toHaveCount(3);
      await expect(cards.nth(0)).toHaveAttribute("href", `/${locale}/projects/new`);
      await expect(cards.nth(1)).toHaveAttribute("href", `/${locale}/store`);
      await expect(cards.nth(2)).toHaveAttribute("href", "https://wa.me/97466567410");
      await expect(cards.nth(0)).toContainText(msg(locale, "StoreLanding", "founders1Title"));
    });

    test("store page search box shows the same dropdown", async ({ page }) => {
      await page.goto(`/${locale}/store`);
      const input = page.locator("#store-search");
      await input.click();
      await input.pressSequentially("dc motor", { delay: 30 });
      await expect(page.getByRole("listbox").getByRole("option").first()).toBeVisible({ timeout: 15_000 });
      await expect(input).toHaveAttribute("role", "combobox");
      await expectNoHorizontalOverflow(page);
    });

    test("search: 'dc motor' shows a dropdown; arrows, Esc, Enter; Add to cart updates the badge", async ({ page, baseURL }) => {
      const { posted } = await mockCartWrites(page);
      // Remember the suggested products so the mocked cart can return them.
      page.on("response", async (res) => {
        if (!res.url().includes("/api/store/search")) return;
        const body = (await res.json().catch(() => null)) as { results?: { id: string }[] } | null;
        if (!body?.results) return;
        await page
          .evaluate((list) => {
            const w = window as unknown as { __w7parts?: Record<string, unknown> };
            w.__w7parts ??= {};
            for (const p of list as { id: string; thumb: string | null }[]) w.__w7parts[p.id] = { ...p, image_url: p.thumb, category: null };
          }, body.results)
          .catch(() => {});
      });

      await gotoHome(page, locale, baseURL);
      const input = page.locator('form[role="search"] input[name="q"]');
      await input.click();
      await input.pressSequentially("dc motor", { delay: 30 });

      const list = page.getByRole("listbox");
      const options = list.getByRole("option");
      await expect(options.first()).toBeVisible({ timeout: 15_000 });
      expect(await options.count()).toBeLessThanOrEqual(6);
      await expect(input).toHaveAttribute("aria-expanded", "true");
      const add = options.first().getByRole("button").filter({ hasText: msg(locale, "StoreSearch", "addToCart") });
      await expect(add).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Arrow keys move the highlight; Esc closes.
      await input.press("ArrowDown");
      const firstId = await options.first().getAttribute("id");
      await expect(input).toHaveAttribute("aria-activedescendant", firstId!);
      await expect(options.first()).toHaveAttribute("aria-selected", "true");
      await input.press("Escape");
      await expect(list).toHaveCount(0);
      await expect(input).toHaveAttribute("aria-expanded", "false");

      // Add to cart (mocked writes) adds in place and the header badge shows 1.
      await input.press("ArrowDown"); // reopen
      await input.fill("dc motor ");
      await expect(options.first()).toBeVisible();
      await options.first().getByRole("button").filter({ hasText: msg(locale, "StoreSearch", "addToCart") }).click();
      const added = options.first().locator(`a[href="/${locale}/store/cart"]`);
      await expect(added).toBeVisible({ timeout: 15_000 });
      await expect(added).toContainText(msg(locale, "StoreSearch", "added"));
      expect(posted).toHaveLength(1);
      await expect(page.locator(`header a[href="/${locale}/store/cart"]`).first()).toContainText("1");
      expect(page.url()).toMatch(new RegExp(`/${locale}(/v2)?/?$`));

      // Enter with nothing highlighted goes to the full results page.
      await input.click();
      await input.fill("dc motor");
      await input.press("Enter");
      await page.waitForURL(new RegExp(`/${locale}/store\\?q=dc\\+motor`));
    });
  });
}
