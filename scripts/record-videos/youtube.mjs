// Turn a cut feature video into a YouTube upload: 1920x1080, captions burnt in
// for one language, a title card at the start and an end card with the site.
//
//   node scripts/record-videos/youtube.mjs <slug> <outRoot> --lang ar \
//     --title "…" --sub "…" --end "…"
//
// Reads <outRoot>/final/<slug>/<slug>.mp4 + <slug>.<lang>.vtt (from edit.mjs).
// Writes <outRoot>/final/<slug>/<slug>.youtube.<lang>.mp4 (H.264 + silent AAC,
// so YouTube's audio library can add music) and <slug>.youtube.<lang>.vtt
// (the captions shifted by the title card, for an optional caption track).
// Text is drawn with libass (Arabic shaping + RTL) in Segoe UI from
// C:\Windows\Fonts. ffmpeg: FFMPEG env, else PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [slug, outRoot] = process.argv.slice(2);
const arg = (name, dflt = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
if (!slug || !outRoot) {
  console.error('Usage: node scripts/record-videos/youtube.mjs <slug> <outRoot> --lang ar --title "…" --sub "…" --end "…"');
  process.exit(1);
}
const lang = arg("lang", "ar");
const rtl = lang === "ar";
const title = arg("title");
const sub = arg("sub");
const endLine = arg("end");
const SITE = "gestaltung360.com";
const BRAND = rtl ? "جِشتالتُونج" : "Gestaltung";
const INTRO = 3.5;
const OUTRO = 4;
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FONT_DIR = process.env.FONT_DIR || "C:/Windows/Fonts";

const dir = path.resolve(outRoot, "final", slug);
const src = path.join(dir, `${slug}.mp4`);
const vtt = fs.readFileSync(path.join(dir, `${slug}.${lang}.vtt`), "utf8");

// ── captions ────────────────────────────────────────────────────────────────
const secs = (s) => {
  const [h, m, rest] = s.trim().split(":");
  return +h * 3600 + +m * 60 + +rest;
};
const cues = vtt
  .split(/\r?\n\r?\n/)
  .map((b) => b.split(/\r?\n/))
  .filter((l) => l.some((x) => x.includes("-->")))
  .map((l) => {
    const i = l.findIndex((x) => x.includes("-->"));
    const [a, b] = l[i].split("-->");
    return { start: secs(a), end: secs(b), text: l.slice(i + 1).join(" ") };
  });

const probe = execFileSync(process.env.FFPROBE || "ffprobe",
  ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", src]).toString();
const mainLen = parseFloat(probe);
const total = INTRO + mainLen + OUTRO;

// ── ASS (1920x1080) ─────────────────────────────────────────────────────────
const ts = (t) => {
  const cs = Math.round(t * 100);
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
// ASS colours are &HAABBGGRR.
const HEADING = "&H0034241C"; // #1c2434
const MUTED = "&H00776A5A"; // #5a6677
const COBALT = "&H00C5590E"; // #0e59c5
const WHITE = "&H00FFFFFF";
const BOX = "&H3034241C"; // heading colour, slightly see-through
const esc = (s) => s.replace(/[{}]/g, "").replace(/\n/g, "\\N");
const ass = [
  "[Script Info]",
  "ScriptType: v4.00+",
  "PlayResX: 1920",
  "PlayResY: 1080",
  "WrapStyle: 0",
  "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  `Style: Cap,Segoe UI,54,${WHITE},${WHITE},${BOX},${BOX},-1,0,0,0,100,100,0,0,3,22,0,2,160,160,70,1`,
  `Style: Brand,Segoe UI,46,${COBALT},${COBALT},${COBALT},&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1`,
  `Style: Title,Segoe UI,104,${HEADING},${HEADING},${HEADING},&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,160,160,0,1`,
  `Style: Sub,Segoe UI,50,${MUTED},${MUTED},${MUTED},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,220,220,0,1`,
  `Style: Site,Segoe UI,64,${COBALT},${COBALT},${COBALT},&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1`,
  "",
  "[Events]",
  "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];
const ev = (start, end, style, text, pos, fade = "\\fad(350,250)") =>
  ass.push(`Dialogue: 0,${ts(start)},${ts(end)},${style},,0,0,0,,{${fade}\\pos(${pos})}${esc(text)}`);
// Title card.
ev(0.15, INTRO, "Brand", BRAND, "960,330");
ev(0.3, INTRO, "Title", title, "960,480");
if (sub) ev(0.5, INTRO, "Sub", sub, "960,650");
// Captions over the clip.
for (const c of cues) {
  ass.push(`Dialogue: 0,${ts(INTRO + c.start + 0.1)},${ts(INTRO + c.end)},Cap,,0,0,0,,{\\fad(150,150)}${esc(c.text)}`);
}
// End card.
const o = INTRO + mainLen;
ev(o + 0.2, total, "Brand", BRAND, "960,360");
ev(o + 0.35, total, "Title", endLine || title, "960,500");
ev(o + 0.6, total, "Site", SITE, "960,660");
const tmp = path.join(dir, `_yt_${lang}`);
fs.mkdirSync(tmp, { recursive: true });
fs.writeFileSync(path.join(tmp, "captions.ass"), ass.join("\n") + "\n", "utf8");

// The shifted captions as a plain track too.
const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))}.${p(ms % 1000, 3)}`;
};
fs.writeFileSync(
  path.join(dir, `${slug}.youtube.${lang}.vtt`),
  "WEBVTT\n\n" + cues.map((c, i) => `${i + 1}\n${stamp(INTRO + c.start)} --> ${stamp(INTRO + c.end)}\n${c.text}`).join("\n\n") + "\n",
  "utf8",
);

// Fonts next to the .ass, so libass finds them without escaping a Windows path.
const fonts = path.join(tmp, "fonts");
fs.mkdirSync(fonts, { recursive: true });
for (const f of ["segoeui.ttf", "segoeuib.ttf"]) fs.copyFileSync(path.join(FONT_DIR, f), path.join(fonts, f));

// ── video ───────────────────────────────────────────────────────────────────
const out = path.join(dir, `${slug}.youtube.${lang}.mp4`);
const BG = "0xEEF2F7";
const filter = [
  `color=c=${BG}:s=1920x1080:r=30:d=${INTRO}[intro]`,
  `[0:v]fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[main]`,
  `color=c=${BG}:s=1920x1080:r=30:d=${OUTRO}[outro]`,
  `[intro][main][outro]concat=n=3:v=1:a=0,format=yuv420p,` +
    `subtitles=captions.ass:fontsdir=fonts,` +
    `fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5[v]`,
].join(";");
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-i", src,
  "-f", "lavfi", "-t", total.toFixed(2), "-i", "anullsrc=r=48000:cl=stereo",
  "-filter_complex", filter, "-map", "[v]", "-map", "1:a",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out,
], { stdio: "inherit", cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${path.basename(out)}: ${total.toFixed(1)} s, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
