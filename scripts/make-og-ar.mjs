// Pre-renders the Arabic text of the /ar share card (app/[locale]/opengraph-image.tsx)
// into assets/og/ar-text.png: a transparent 1200x630 PNG holding only the Arabic
// brand name, tagline and three paths. Satori (next/og) shapes Arabic letters but
// measures and orders them wrongly (loose word gaps, text not flush right), while
// Chrome shapes and lays Arabic out correctly, so Chrome draws it here.
//
// Run locally after changing Brand.tagline / Nav.path* in messages/ar.json:
//   node scripts/make-og-ar.mjs
// Needs network (IBM Plex Sans Arabic from Google Fonts) and a local Chrome/Edge
// (CHROME_PATH overrides the lookup). Playwright is NOT a project dependency.
// The PNG lives outside /public; the route reads it with fs at build time.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ar = JSON.parse(readFileSync(join(root, "messages/ar.json"), "utf8"));
const name = ar.Brand.name;
const tagline = ar.Brand.tagline;
const paths = [ar.Nav.pathBuy, ar.Nav.pathMake, ar.Nav.pathIdea].join(" · ");

const INK = "#1c2434";
const COBALT = "#0e59c5";
// Layout (px, 1200x630): the G mark sits top-right at x 1024..1120, y 72..168.
const RIGHT_EDGE = 1120; // 80px right padding, same as the English card
const NAME_RIGHT = 1120 - 96 - 28; // left of the G mark with a 28px gap

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chrome = chromeCandidates.find((p) => existsSync(p));
if (!chrome) throw new Error("No Chrome/Edge found; set CHROME_PATH");

// Font: Plex Arabic Bold, subset to the glyphs used (TTF via an old UA).
const glyphs = Array.from(new Set(Array.from(name + tagline + paths))).join("");
const css = await (
  await fetch(
    `https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@700&text=${encodeURIComponent(glyphs)}`,
    { headers: { "User-Agent": "Mozilla/4.0" } }
  )
).text();
const fontUrl = css.match(/url\((https:[^)]+)\)/)?.[1];
if (!fontUrl) throw new Error("Could not read the font URL from Google Fonts CSS");
const font = Buffer.from(await (await fetch(fontUrl)).arrayBuffer());

const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
@font-face{font-family:Plex;font-weight:700;src:url(data:font/ttf;base64,${font.toString("base64")})}
html,body{margin:0;width:1200px;height:630px;background:transparent;overflow:hidden}
body{font-family:Plex,sans-serif;font-weight:700;position:relative}
.name{position:absolute;top:72px;height:96px;display:flex;align-items:center;right:${1200 - NAME_RIGHT}px;font-size:80px;color:${INK};white-space:nowrap}
.mid{position:absolute;top:190px;height:250px;right:${1200 - RIGHT_EDGE}px;width:760px;display:flex;flex-direction:column;justify-content:center}
.tag{font-size:54px;line-height:1.5;color:${INK}}
.paths{font-size:34px;line-height:1.5;margin-top:24px;color:${COBALT}}
</style><body><div class="name">${name}</div><div class="mid">${tagline.split(" · ").map((l) => `<div class="tag">${l}</div>`).join("")}<div class="paths">${paths}</div></div></body></html>`;

const tmp = mkdtempSync(join(tmpdir(), "og-ar-"));
try {
  writeFileSync(join(tmp, "card.html"), html);
  const shot = join(tmp, "shot.png");
  execFileSync(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "--default-background-color=00000000",
    "--window-size=1200,630",
    `--screenshot=${shot}`,
    pathToFileURL(join(tmp, "card.html")).href,
  ], { stdio: "ignore" });

  const out = join(root, "assets/og/ar-text.png");
  const meta = await sharp(shot).metadata();
  let img = sharp(shot);
  if (meta.width !== 1200 || meta.height !== 630) {
    img = img.extract({ left: 0, top: 0, width: Math.min(1200, meta.width), height: Math.min(630, meta.height) });
  }
  await img.png({ palette: true, colours: 48, effort: 10 }).toFile(out);
  const info = await sharp(out).metadata();
  console.log(`wrote assets/og/ar-text.png ${info.width}x${info.height}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
