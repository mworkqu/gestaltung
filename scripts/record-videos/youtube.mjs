// Build a YouTube video from recorder takes: 1920x1080, a title card, the cut
// clips, voice-over lines placed per segment, captions burnt in (the spoken
// line, shown while it is spoken), an end card with the site, and background
// music that dips under the voice.
//
//   node scripts/record-videos/youtube.mjs <plan> <outRoot> --vo <dir> --script <txt> [--music <wav>] [--out <mp4>]
//
// <plan> = scripts/record-videos/cuts/youtube-<lang>.json:
//   sources:  raw takes, relative to <outRoot>
//   crop:     optional [[w, h] | null, …] per source: the part of the frame
//             that holds the page (top-left), e.g. [1600, 900] for a take whose
//             video frame was larger than its viewport
//   intro / outro: { seconds, title, sub? }
//   voIntro / voOutro: { vo, at }   voice line N starts `at` s into the card
//   segments: [{ src, from, to, speed, vo?, at?, vo2?, at2? }]  source seconds;
//             vo = line number in the script, at = seconds after the segment starts
// --vo dir holds vo<N>.wav (tts.mjs); --script is the same text file (captions).
// No --music: a track is made with music.mjs. Text drawn by libass (Arabic
// shaping + RTL) in Segoe UI. ffmpeg: FFMPEG env, else PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [planFile, outRoot] = process.argv.slice(2);
const opt = (n, d = "") => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
if (!planFile || !outRoot || !opt("vo") || !opt("script")) {
  console.error("Usage: node scripts/record-videos/youtube.mjs <plan.json> <outRoot> --vo <dir> --script <txt> [--music <wav>] [--out <mp4>]");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
const root = path.resolve(outRoot);
const voDir = path.resolve(opt("vo"));
const lines = fs.readFileSync(opt("script"), "utf8").split(/\r?\n/).filter((l) => l.trim());
const rtl = plan.lang === "ar";
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || "ffprobe";
const FONT_DIR = process.env.FONT_DIR || "C:/Windows/Fonts";
const BRAND = rtl ? "جِشتالتُونج" : "Gestaltung";
const SITE = "gestaltung360.com";
const out = path.resolve(opt("out", path.join(root, "final", `youtube-${plan.lang}.mp4`)));
fs.mkdirSync(path.dirname(out), { recursive: true });
const tmp = path.join(path.dirname(out), `_yt_${plan.lang}`);
fs.mkdirSync(path.join(tmp, "fonts"), { recursive: true });
const run = (args, cwd) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit", cwd });
const dur = (f) => parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

// ── timeline ────────────────────────────────────────────────────────────────
const INTRO = plan.intro.seconds;
const OUTRO = plan.outro.seconds;
let cursor = INTRO;
const voice = []; // { n, start }
const addVo = (n, start) => n && voice.push({ n, start });
if (plan.voIntro) addVo(plan.voIntro.vo, plan.voIntro.at);
const segs = plan.segments.map((s) => {
  const len = (s.to - s.from) / s.speed;
  const seg = { ...s, start: cursor, len };
  addVo(s.vo, cursor + (s.at ?? 0));
  addVo(s.vo2, cursor + (s.at2 ?? 0));
  cursor += len;
  return seg;
});
const outroStart = cursor;
if (plan.voOutro) addVo(plan.voOutro.vo, outroStart + plan.voOutro.at);
const total = outroStart + OUTRO;
for (const v of voice) {
  v.file = path.join(voDir, `vo${v.n}.wav`);
  v.len = dur(v.file);
  v.text = lines[v.n - 1].replace(/[.«»]/g, "").trim();
}
voice.sort((a, b) => a.start - b.start);
voice.forEach((v, i) => {
  const next = voice[i + 1];
  if (next && v.start + v.len > next.start) console.warn(`! vo${v.n} runs into vo${next.n} by ${(v.start + v.len - next.start).toFixed(2)} s`);
});

// ── captions + cards (ASS, 1920x1080) ───────────────────────────────────────
const ts = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const p = (n) => String(n).padStart(2, "0");
  return `${Math.floor(cs / 360000)}:${p(Math.floor((cs % 360000) / 6000))}:${p(Math.floor((cs % 6000) / 100))}.${p(cs % 100)}`;
};
const HEADING = "&H0034241C", MUTED = "&H00776A5A", COBALT = "&H00C5590E", WHITE = "&H00FFFFFF", BOX = "&H3034241C";
const esc = (s) => s.replace(/[{}]/g, "").replace(/\n/g, "\\N");
const ass = [
  "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1920", "PlayResY: 1080", "WrapStyle: 0", "",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
  `Style: Cap,Segoe UI,50,${WHITE},${WHITE},${BOX},${BOX},-1,0,0,0,100,100,0,0,3,20,0,2,240,240,60,1`,
  `Style: Brand,Segoe UI,46,${COBALT},${COBALT},${COBALT},&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1`,
  `Style: Title,Segoe UI,100,${HEADING},${HEADING},${HEADING},&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,160,160,0,1`,
  `Style: Sub,Segoe UI,46,${MUTED},${MUTED},${MUTED},&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,260,260,0,1`,
  `Style: Site,Segoe UI,64,${COBALT},${COBALT},${COBALT},&H00000000,-1,0,0,0,100,100,0,0,1,0,0,5,120,120,0,1`,
  "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
];
const ev = (a, b, style, text, pos) => ass.push(`Dialogue: 0,${ts(a)},${ts(b)},${style},,0,0,0,,{\\fad(350,250)\\pos(${pos})}${esc(text)}`);
ev(0.15, INTRO, "Brand", BRAND, "960,330");
ev(0.3, INTRO, "Title", plan.intro.title, "960,480");
if (plan.intro.sub) ev(0.5, INTRO, "Sub", plan.intro.sub, "960,640");
ev(outroStart + 0.2, total, "Brand", BRAND, "960,360");
ev(outroStart + 0.35, total, "Title", plan.outro.title, "960,500");
ev(outroStart + 0.6, total, "Site", SITE, "960,660");
// Spoken lines as captions (not over the cards, which already show text).
const vtt = [];
for (const v of voice) {
  // The title card has its own text; on the end card a line is captioned
  // unless it just repeats the card's title.
  if (v.start < INTRO) continue;
  const onOutro = v.start >= outroStart;
  if (onOutro && v.text.includes(plan.outro.title)) continue;
  const end = onOutro ? total : Math.min(v.start + v.len + 0.5, outroStart);
  ass.push(`Dialogue: 0,${ts(v.start)},${ts(end)},Cap,,0,0,0,,{\\fad(150,150)}${esc(v.text)}`);
  vtt.push({ start: v.start, end, text: v.text });
}
fs.writeFileSync(path.join(tmp, "captions.ass"), ass.join("\n") + "\n", "utf8");
for (const f of ["segoeui.ttf", "segoeuib.ttf"]) fs.copyFileSync(path.join(FONT_DIR, f), path.join(tmp, "fonts", f));
const stamp = (t) => ts(t).replace(/^(\d):/, "0$1:") + "0";
fs.writeFileSync(out.replace(/\.mp4$/, ".vtt"),
  "WEBVTT\n\n" + vtt.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join("\n\n") + "\n", "utf8");

// ── music ───────────────────────────────────────────────────────────────────
let music = opt("music");
if (!music) {
  music = path.join(tmp, "music.wav");
  execFileSync(process.execPath, [path.join(here, "music.mjs"), music, String(Math.ceil(total) + 1)], { stdio: "inherit" });
}

// ── render ──────────────────────────────────────────────────────────────────
const BG = "0xEEF2F7";
const inputs = plan.sources.flatMap((s) => ["-i", path.join(root, s)]);
const nSrc = plan.sources.length;
const voInputs = voice.flatMap((v) => ["-i", v.file]);
const musicIdx = nSrc + voice.length;
const cropOf = (src) => {
  const c = plan.crop?.[src];
  return c ? `crop=${c[0]}:${c[1]}:0:0,` : "";
};
const vparts = segs.map((s, i) =>
  `[${s.src}:v]trim=start=${s.from}:end=${s.to},setpts=(PTS-STARTPTS)/${s.speed},${cropOf(s.src)}fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p[v${i}]`);
const video =
  `color=c=${BG}:s=1920x1080:r=30:d=${INTRO},format=yuv420p[vin];` +
  `color=c=${BG}:s=1920x1080:r=30:d=${OUTRO},format=yuv420p[vout];` +
  vparts.join(";") + ";" +
  `[vin]${segs.map((_, i) => `[v${i}]`).join("")}[vout]concat=n=${segs.length + 2}:v=1:a=0,` +
  `subtitles=captions.ass:fontsdir=fonts,fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6[v]`;
const vo = voice.map((v, i) => {
  const ms = Math.round(v.start * 1000);
  return `[${nSrc + i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=1.6,adelay=${ms}|${ms}[a${i}]`;
});
const audio =
  vo.join(";") + ";" +
  `${voice.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voice.length}:normalize=0:duration=longest,apad=whole_dur=${total.toFixed(2)},asplit=2[voice][key];` +
  `[${musicIdx}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(2)},volume=0.55[mus];` +
  `[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=500[duck];` +
  `[voice][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5,alimiter=limit=0.84:level=false,atrim=0:${total.toFixed(2)}[a]`;
run([
  ...inputs, ...voInputs, "-i", music,
  "-filter_complex", video + ";" + audio,
  "-map", "[v]", "-map", "[a]",
  "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", total.toFixed(2), out,
], tmp);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${path.basename(out)}: ${total.toFixed(1)} s, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB, ${voice.length} voice lines`);
for (const v of voice) console.log(`  ${v.start.toFixed(1).padStart(5)} s  vo${v.n} (${v.len.toFixed(1)} s)`);
