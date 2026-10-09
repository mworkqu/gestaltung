import { expect, LOCALES, test } from "./fixtures";

// site_v2 flag (lib/site-v2.ts, middleware.ts). The flag is read from the
// production store_settings (read-only fetch). While it is OFF:
//   /:locale/v2   -> 404 without the preview cookie
//   /:locale/v2   -> 200 with site_v2=1, robots noindex, canonical = public URL
// After the cut-over (flag ON) the same URL 308s to the public page; this spec
// follows whichever state the site is in, so it stays green through the flip.
for (const locale of LOCALES) {
  test(`site_v2 flag [${locale}]`, async ({ page, context, request, baseURL }) => {
    // A cookie-less probe: does the site currently redirect /v2 (flag ON)?
    const probe = await request.get(`/${locale}/v2`, { maxRedirects: 0 });
    const flagOn = probe.status() === 308;

    if (flagOn) {
      expect(new URL(probe.headers()["location"], baseURL).pathname).toBe(`/${locale}`);
      await page.goto(`/${locale}`);
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
      return;
    }

    // Flag OFF: no cookie -> 404.
    const none = await page.goto(`/${locale}/v2`);
    expect(none?.status()).toBe(404);

    // The public home is the old page, indexable.
    const home = await page.goto(`/${locale}`);
    expect(home?.status()).toBe(200);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);

    // Preview cookie -> 200 and noindex.
    await context.addCookies([{ name: "site_v2", value: "1", url: baseURL ?? "http://localhost:3000" }]);
    const res = await page.goto(`/${locale}/v2`);
    expect(res?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1);
    // Canonical points at the public URL, never /v2.
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(canonical).toBeTruthy();
    expect(new URL(canonical!).pathname).toBe(`/${locale}`);
  });
}
