// Make placeholder files for the six feature videos, to test the player
// before the real clips exist.
//
//   node scripts/make-video-placeholders.mjs <outDir>
//
// For each slug it creates <outDir>/<slug>/ with a 1280x720 poster
// (<slug>.jpg, sharp), <slug>.en.vtt and <slug>.ar.vtt (one cue with the
// title) and, only if ffmpeg is on PATH, a 5-second <slug>.mp4 and
// <slug>.webm. Upload a folder with: node scripts/upload-video.mjs <outDir>/<slug>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Keep in step with lib/videos.ts (VIDEO_SLUGS) and messages Videos.<slug>Title.
const VIDEOS = [
  { slug: "idea-to-kit", en: "From one sentence to a parts list", ar: "من جملة واحدة إلى قائمة قطع" },
  { slug: "file-to-part", en: "Drop a file, get the part", ar: "أرفق ملفًا واحصل على القطعة" },
  { slug: "sketch-to-drawing", en: "A photo and three dimensions", ar: "صورة وثلاثة أبعاد" },
  { slug: "wiring-check", en: "Every connection checked", ar: "كل توصيلة تُفحص" },
  { slug: "cad-model", en: "The board needs a box", ar: "اللوحة تحتاج إلى علبة" },
  { slug: "store-to-door", en: "Stocked in Qatar or sourced for you", ar: "متوفر في قطر أو نوفّره لك" },
];

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node scripts/make-video-placeholders.mjs <outDir>");
  process.exit(1);
}

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const vtt = (title) => `WEBVTT\n\n00:00:00.000 --> 00:00:05.000\n${title}\n`;
const ffmpeg = hasFfmpeg();

for (const { slug, en, ar } of VIDEOS) {
  const dir = path.join(outDir, slug);
  fs.mkdirSync(dir, { recursive: true });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <rect width="1280" height="720" fill="#eef2f7"/>
  <text x="640" y="340" text-anchor="middle" font-family="Arial, sans-serif" font-size="64" font-weight="700" fill="#0e59c5">${esc(slug)}</text>
  <text x="640" y="410" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#475569">${esc(en)}</text>
  <text x="640" y="470" text-anchor="middle" font-family="Arial, sans-serif" font-size="22" fill="#64748b">placeholder poster 1280x720</text>
</svg>`;
  await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#eef2f7" } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toFile(path.join(dir, `${slug}.jpg`));

  fs.writeFileSync(path.join(dir, `${slug}.en.vtt`), vtt(en));
  fs.writeFileSync(path.join(dir, `${slug}.ar.vtt`), vtt(ar));

  if (ffmpeg) {
    const src = ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x0e59c5:s=1280x720:d=5", "-pix_fmt", "yuv420p"];
    execFileSync("ffmpeg", [...src, path.join(dir, `${slug}.mp4`)], { stdio: "inherit" });
    execFileSync("ffmpeg", [...src, path.join(dir, `${slug}.webm`)], { stdio: "inherit" });
  }
  console.log(`made  ${dir}${ffmpeg ? "" : "  (poster + captions only)"}`);
}

if (!ffmpeg) {
  console.log("\nffmpeg is not installed, so no .mp4 / .webm were made.");
  console.log("Install it on Windows with:  winget install Gyan.FFmpeg   (then open a new terminal and run this again)");
}
