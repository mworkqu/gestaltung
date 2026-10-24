import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, expectLocale, LOCALES, test, type Loc } from "./fixtures";

// F-029..F-034 follow-up: an axe-core scan of the pages a customer meets first,
// in EN and AR. Read-only like the rest of the suite (the write guard in
// ./fixtures stays on: this spec only navigates).
//
// Only SERIOUS and CRITICAL violations fail. A zero-tolerance scan on an
// existing site would never pass and would just get switched off, so minor and
// moderate findings are reported in the attachment but do not fail the run.
//
// Anything we know about and cannot fix here goes in ALLOWED, one entry per
// rule + page, each with the finding it belongs to and why it is still open.
// An entry that no longer matches anything FAILS the test, so the list cannot
// quietly rot. Today it is empty: the spec was written without being run, so
// the first `npm run test:e2e` is what tells us whether anything belongs here.

type Allowed = { rule: string; page: string; finding: string; why: string };
const ALLOWED: Allowed[] = [];

type Target = { id: string; path: (l: Loc) => string };

const STATIC_TARGETS: Target[] = [
  { id: "home", path: (l) => `/${l}` },
  { id: "store", path: (l) => `/${l}/store` },
  // Without a cart this redirects (server-side) to the empty cart, so that is
  // what gets scanned; a seeded cart would need a write to production.
  { id: "checkout", path: (l) => `/${l}/store/checkout` },
  { id: "studio-fixture", path: (l) => `/${l}/e2e-fixtures/studio` },
];

const RESERVED = new Set(["cart", "checkout", "search", "collections"]);

/** The first real product on the store list; no product SKU is hard-coded. */
async function firstProductPath(page: Page, locale: Loc): Promise<string> {
  await page.goto(`/${locale}/store`);
  const hrefs = await page
    .locator(`a[href^="/${locale}/store/"]`)
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
  for (const h of hrefs) {
    const m = new RegExp(`^/${locale}/store/([^/?#]+)$`).exec(h);
    if (m && !RESERVED.has(m[1])) return h;
  }
  throw new Error("no product card found on the store list");
}

async function scan(page: Page, id: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const unexpected = blocking.filter((v) => !ALLOWED.some((a) => a.rule === v.id && a.page === id));
  const stale = ALLOWED.filter((a) => a.page === id && !blocking.some((v) => v.id === a.rule));
  return { unexpected, stale };
}

function describeViolations(list: Awaited<ReturnType<typeof scan>>["unexpected"]): string {
  return list
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 3).map((n) => `   ${n.target.join(" ")}`).join("\n")}`)
    .join("\n");
}

test.describe("axe-core: serious and critical violations", () => {
  test.skip(({ isMobile }) => isMobile, "one viewport is enough for axe; the desktop project runs it");

  for (const locale of LOCALES) {
    for (const target of STATIC_TARGETS) {
      test(`${target.id} [${locale}]`, async ({ page }, testInfo) => {
        const res = await page.goto(target.path(locale));
        if (target.id === "studio-fixture") {
          expect(res?.status(), "start the server with E2E_FIXTURES=1").toBe(200);
        }
        await expectLocale(page, locale);
        const { unexpected, stale } = await scan(page, target.id);
        await testInfo.attach("axe-blocking", { body: describeViolations(unexpected) || "none", contentType: "text/plain" });
        expect(unexpected.length, describeViolations(unexpected)).toBe(0);
        expect(stale, "allow-list entries that no longer match: remove them").toEqual([]);
      });
    }

    test(`product page [${locale}]`, async ({ page }, testInfo) => {
      const href = await firstProductPath(page, locale);
      await page.goto(href);
      await expectLocale(page, locale);
      const { unexpected, stale } = await scan(page, "product");
      await testInfo.attach("axe-blocking", { body: describeViolations(unexpected) || "none", contentType: "text/plain" });
      expect(unexpected.length, describeViolations(unexpected)).toBe(0);
      expect(stale, "allow-list entries that no longer match: remove them").toEqual([]);
    });
  }
});
