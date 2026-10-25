// Click-through screenshots for the fix/review-2026-10 report.
//
//   npm run build
//   PORT=3100 E2E_FIXTURES=1 npm run start -- -p 3100
//   node scripts/review-screenshots.mjs            (override with REVIEW_ORIGIN)
//
// Read-only: it navigates and screenshots, nothing is submitted and no form is
// filled, so it cannot write to the production Supabase the app points at.
// Files land in review/fixes/screenshots/<page>-<locale>-<width>.png.

import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const ORIGIN = process.env.REVIEW_ORIGIN || "http://localhost:3100";
const OUT = "review/fixes/screenshots";
const WIDTHS = [1366, 375];
const HASH = "abcdefghijklmnopqrstuvwxyz012345"; // shape-valid, not a real token

/** Pages a customer meets, plus everything this branch changed. */
const PAGES = [
  ["home", (l) => `/${l}`],
  ["store", (l) => `/${l}/store`],
  ["cart", (l) => `/${l}/store/cart`],
  ["checkout", (l) => `/${l}/store/checkout`],
  ["pricing", (l) => `/${l}/pricing`],
  ["terms", (l) => `/${l}/terms`],
  ["sign-up", (l) => `/${l}/sign-up`],
  ["forgot-password", (l) => `/${l}/forgot-password`],
  ["forgot-password-expired", (l) => `/${l}/forgot-password?expired=1`],
  ["reset-password-link", (l) => `/${l}/reset-password?token_hash=${HASH}&type=recovery`],
  ["reset-password-code", (l) => `/${l}/reset-password`],
  ["confirm-email", (l) => `/${l}/confirm-email?token_hash=${HASH}&type=signup`],
  ["not-found", (l) => `/${l}/this-does-not-exist`],
  ["studio-parts", (l) => `/${l}/e2e-fixtures/studio?step=parts`],
  ["studio-wiring", (l) => `/${l}/e2e-fixtures/studio?step=wiring`],
  ["studio-enclosure", (l) => `/${l}/e2e-fixtures/studio?step=enclosure`],
  ["studio-print", (l) => `/${l}/e2e-fixtures/studio?step=print`],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let shot = 0;
const problems = [];

for (const width of WIDTHS) {
  for (const locale of ["en", "ar"]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 375 ? 812 : 900 },
      isMobile: width === 375,
      hasTouch: width === 375,
    });
    const page = await context.newPage();
    for (const [name, path] of PAGES) {
      const url = `${ORIGIN}${path(locale)}`;
      try {
        const res = await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        // The entry animations settle in well under a second; without this the
        // shots catch half-faded sections (F-038 is about exactly that).
        await page.waitForTimeout(600);
        const status = res?.status() ?? 0;
        // /this-does-not-exist is MEANT to be 404; anything else that is not 200
        // is worth seeing in the report rather than silently shooting.
        if (status !== 200 && !(name === "not-found" && status === 404)) {
          problems.push(`${name} ${locale} ${width}: HTTP ${status}`);
        }
        await page.screenshot({ path: `${OUT}/${name}-${locale}-${width}.png`, fullPage: true });
        shot += 1;
      } catch (err) {
        problems.push(`${name} ${locale} ${width}: ${err.message.split("\n")[0]}`);
      }
    }
    await context.close();
  }
}

await browser.close();
console.log(`wrote ${shot} screenshots to ${OUT}`);
if (problems.length) {
  console.log(`\n${problems.length} page(s) did not load cleanly:`);
  for (const p of problems) console.log(`  ${p}`);
}
