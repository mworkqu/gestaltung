import { expect, expectLocale, expectNoHorizontalOverflow, LOCALES, msg, test } from "./fixtures";

// /pricing order (CLAUDE.md "PHASE 1.4 PRICING"). One markup, two orders: the
// DOM is the phone order (planOrderMobile: Maker, Builder, Studio,
// Institutions) and lg:order-N re-sorts to planOrderDesktop (Studio, Builder,
// Maker, Institutions). Checked by position, not by class names. These are the
// defaults in lib/pricing/defaults.ts; the order follows store_settings
// pricing_plans, so an owner edit that changes prices/anchor/target changes it.
const MOBILE_ORDER = ["maker", "builder", "studio", "institutions"] as const;
const DESKTOP_ORDER = ["studio", "builder", "maker", "institutions"] as const;

for (const locale of LOCALES) {
  test(`pricing shows four plans in the right order [${locale}]`, async ({ page }) => {
    await page.goto(`/${locale}/pricing`);
    await expectLocale(page, locale);

    const items = page.locator('section[aria-labelledby="plans-heading"] > ul > li');
    await expect(items).toHaveCount(4);

    // DOM order = phone order.
    const names = MOBILE_ORDER.map((id) => msg(locale, "Pricing", `plan_${id}`));
    const domNames = await items.locator("h3").allTextContents();
    expect(domNames.map((n) => n.trim())).toEqual(names);

    // The cards fade up on entry (a transform): let finite animations end so the
    // boxes are the final layout.
    await page.evaluate(() =>
      Promise.race([
        Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
        new Promise((r) => setTimeout(r, 3000)),
      ]),
    );

    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const box = await items.nth(i).boundingBox();
      if (!box) throw new Error(`no box for plan ${names[i]}`);
      boxes.push(box);
    }
    const byId = Object.fromEntries(MOBILE_ORDER.map((id, i) => [id, boxes[i]])) as Record<
      (typeof MOBILE_ORDER)[number],
      (typeof boxes)[number]
    >;

    const isDesktop = (page.viewportSize()?.width ?? 0) >= 1024;
    if (isDesktop) {
      // One row, four columns, ordered by x (reversed in RTL: the first plan is the right-most).
      const sign = locale === "ar" ? -1 : 1;
      const ordered = [...DESKTOP_ORDER].sort((a, b) => sign * (byId[a].x - byId[b].x));
      expect(ordered).toEqual([...DESKTOP_ORDER]);
      const ys = boxes.map((b) => b.y);
      expect(Math.max(...ys) - Math.min(...ys), "all four plans share a row on desktop").toBeLessThanOrEqual(2);
    } else {
      // One column, ordered by y, no overlap.
      const ordered = [...MOBILE_ORDER].sort((a, b) => byId[a].y - byId[b].y);
      expect(ordered).toEqual([...MOBILE_ORDER]);
      for (let i = 1; i < MOBILE_ORDER.length; i++) {
        const prev = byId[MOBILE_ORDER[i - 1]];
        expect(byId[MOBILE_ORDER[i]].y).toBeGreaterThanOrEqual(prev.y + prev.height - 1);
      }
    }
    await expectNoHorizontalOverflow(page);
  });
}
