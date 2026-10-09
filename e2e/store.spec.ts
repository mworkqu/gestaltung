import type { Page } from "@playwright/test";

import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test, type Loc } from "./fixtures";

// Path 4 (read-only): store search -> product -> Add to cart is present ->
// checkout. The cart is NOT seeded:
//  - it lives in cart_items (Supabase), keyed by a user session; the provider
//    reads it only when a session exists, and a guest needs
//    signInAnonymously() + an insert to get one (cart-provider.tsx addItem).
//  - a localStorage cart (the legacy format) is migrated on load THROUGH
//    ensureSession() + inserts, i.e. seeding it would write to production.
// So we assert what is real and read-only: the Add-to-cart button exists
// (never clicked) and /store/checkout with no cart redirects to /store/cart
// (server-side, app/[locale]/store/checkout/page.tsx), which shows the empty
// cart. The payment-methods line is rendered only by checkout-client.tsx,
// unreachable without a cart, so its copy is checked in the messages instead.

const RESERVED = new Set(["cart", "checkout", "search", "collections"]);

async function productPaths(page: Page, locale: Loc): Promise<string[]> {
  const hrefs = await page
    .locator(`a[href^="/${locale}/store/"]`)
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
  const out: string[] = [];
  for (const h of hrefs) {
    const m = new RegExp(`^/${locale}/store/([^/?#]+)$`).exec(h);
    if (m && !RESERVED.has(m[1]) && !out.includes(h)) out.push(h);
  }
  return out;
}

for (const locale of LOCALES) {
  test.describe(`store [${locale}]`, () => {
    test("home has the store search form", async ({ page }) => {
      await page.goto(`/${locale}`);
      await expectLocale(page, locale);
      const form = page.locator(`form[action="/${locale}/store"]`);
      await expect(form).toHaveCount(1);
      await expect(form.locator('input[name="q"]')).toBeVisible();
    });

    test("search -> results -> product (Add to cart, upsell) -> checkout redirects to the empty cart", async ({ page }) => {
      // The search form is a GET to /store?q=...; open its result URL directly (no form is submitted).
      await page.goto(`/${locale}/store?q=arduino`);
      await expectLocale(page, locale);
      expect(new URL(page.url()).searchParams.get("q")).toBe("arduino");

      const addButtons = page.getByRole("button", { name: msg(locale, "Parts", "addToCart") });
      await expect(addButtons.first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const products = await productPaths(page, locale);
      expect(products.length, "search results should list product cards").toBeGreaterThan(0);

      // Open products until one shows an upsell section (bought-together or
      // may-also-need). Which ones do depends on catalogue data.
      let sawUpsell = false;
      let opened = 0;
      for (const href of products.slice(0, 6)) {
        await page.goto(href);
        opened++;
        await expectLocale(page, locale);
        await expect(page.locator("h1")).toBeVisible();
        // Add to cart — present, never clicked.
        await expect(page.getByRole("button", { name: msg(locale, "Parts", "addToCart") }).first()).toBeVisible();
        await expectNoHorizontalOverflow(page);
        const upsell = page.locator("#upsell-heading");
        if (await upsell.count()) {
          const text = (await upsell.textContent())?.trim();
          expect([msg(locale, "Upsell", "boughtTogether"), msg(locale, "Upsell", "mayAlsoNeed")]).toContain(text);
          sawUpsell = true;
          break;
        }
      }
      expect(sawUpsell, `no upsell section on the first ${opened} products`).toBe(true);

      // Checkout with no cart: server redirect to the cart, which says it is empty.
      await page.goto(`/${locale}/store/checkout`);
      await page.waitForURL(`**/${locale}/store/cart`);
      await expectLocale(page, locale);
      await expect(page.getByText(msg(locale, "Parts", "cartEmptyTitle"))).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });

    test("the payment-methods line exists in this locale's messages", () => {
      // See the header comment: checkout-client.tsx is unreachable without a cart.
      const line = msg(locale, "PayMethods", "methodsLine");
      expect(line.length).toBeGreaterThan(20);
    });
  });
}
