// Renders the four Supabase auth email templates (supabase/auth-templates/*.html)
// to PNG at 600 px and 360 px wide into review/fixes/emails/, using local headless
// Chrome/Edge (same approach as scripts/make-og-ar.mjs). No npm dependency.
//
//   node scripts/render-auth-emails.mjs
//
// CHROME_PATH overrides the browser lookup. Supabase placeholders are replaced
// with sample values so the render shows realistic content.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "review/fixes/emails");
const names = ["reset-password", "confirm-signup", "change-email", "magic-link"];

const candidates = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const chrome = candidates.find((p) => existsSync(p));
if (!chrome) {
  console.error("No local Chrome/Edge found; set CHROME_PATH. Nothing rendered.");
  process.exit(1);
}

const samples = {
  "{{ .RedirectTo }}": "https://gestaltung360.com/en/reset-password",
  "{{ .TokenHash }}": "3f9c1b7a52d84e0aa6b1c9d0e7f2a4b85c6d3e1f9a0b7c28d4e5f6a7b8c9d0e1",
  "{{ .Token }}": "123456",
  "{{ .NewEmail }}": "new.address@example.com",
  "{{ .Email }}": "old.address@example.com",
  "{{ .ConfirmationURL }}": "https://example.supabase.co/auth/v1/verify",
  "{{ .SiteURL }}": "https://gestaltung360.com",
};
const fill = (html) =>
  html
    .replace(/\{\{\s*if \.Email\s*\}\}/g, "")
    .replace(/\{\{\s*end\s*\}\}/g, "")
    .replace(/\{\{\s*\.\w+\s*\}\}/g, (m) => samples[m.replace(/\s+/g, " ")] ?? m);

mkdirSync(outDir, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "auth-emails-"));
const written = [];
try {
  for (const name of names) {
    const html = fill(readFileSync(join(root, "supabase/auth-templates", `${name}.html`), "utf8"));
    const file = join(tmp, `${name}.html`);
    writeFileSync(file, html);
    // Headless Chrome will not make a window narrower than ~500 px, so the email is
    // laid out inside an iframe of the exact width; the 360 shot is a 600 px canvas
    // with the 360 px phone column centred on it.
    for (const width of [600, 360]) {
      const wrap = join(tmp, name + "-" + width + ".html");
      writeFileSync(wrap, "<!doctype html><meta charset=utf-8><body style=\"margin:0;background:#dde3ec\"><iframe src=\"" + pathToFileURL(file).href + "\" width=\"" + width + "\" height=\"1700\" style=\"display:block;margin:0 auto;border:0;background:#fff\"></iframe>");
      const out = join(outDir, `${name}-${width}.png`);
      execFileSync(chrome, [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--window-size=600,1700`,
        `--screenshot=${out}`,
        pathToFileURL(wrap).href,
      ], { stdio: "ignore" });
      written.push(out);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
for (const w of written) console.log(`wrote ${w.replace(root, "").replace(/\\/g, "/").replace(/^\//, "")}`);
