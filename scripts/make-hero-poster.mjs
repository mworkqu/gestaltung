// Captures the home hero poster (W7) from the live Studio viewer.
//
//   E2E_FIXTURES=1 npx next start -p 3107      (after `npx next build`)
//   node scripts/make-hero-poster.mjs http://localhost:3107
//
// Opens /en/e2e-fixtures/hero-poster (the hero's demo enclosure standing still,
// 640 x 480), waits for the case to be built, screenshots it at 1.5x and writes
// public/home/hero-enclosure.webp (960 px) + hero-enclosure-480.webp with sharp.
// Keep them small: the script fails above 60 kB (public/ files are served on
// every visit; see the favicon lesson).

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.argv[2] || "http://localhost:3000";
const OUT = path.join(ROOT, "public", "home");
const SIZES = [
  { file: "hero-enclosure.webp", width: 960, height: 720 },
  { file: "hero-enclosure-480.webp", width: 480, height: 360 },
];
const MAX_BYTES = 60 * 1024;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1.5 });
  await page.goto(`${origin}/en/e2e-fixtures/hero-poster`, { waitUntil: "load" });
  await page.waitForSelector('[data-hero-ready="1"]', { timeout: 60_000 });
  await page.waitForTimeout(1500); // camera settle + contact shadows
  const png = await page.locator('[data-testid="hero-poster-box"]').screenshot({ type: "png" });
  for (const { file, width, height } of SIZES) {
    const webp = await sharp(png).resize(width, height, { fit: "cover" }).webp({ quality: 72, effort: 6 }).toBuffer();
    if (webp.length > MAX_BYTES) throw new Error(`${file} is ${webp.length} bytes (> ${MAX_BYTES})`);
    writeFileSync(path.join(OUT, file), webp);
    console.log(`wrote public/home/${file} (${(webp.length / 1024).toFixed(1)} kB)`);
  }
} finally {
  await browser.close();
}
