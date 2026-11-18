// Cut the CAD Champions walkthrough from the recorder's takes and voice-over.
//
//   node scripts/record-videos/cc/edit.mjs <en|ar> <outRoot> [--base http://localhost:3100] [--no-music]
//
// Needs (from tts.py + record.mjs): <outRoot>/<lang>/vo/{<id>.mp3,timings.json},
// <outRoot>/<lang>/raw/{<id>.webm,marks.json,poster.jpg}, and the OTHER
// language's vo/timings.json (its sentences become the second caption track).
// Writes <outRoot>/videos/cc-intro-<lang>/cc-intro-<lang>.{mp4,webm,jpg,en.vtt,ar.vtt}
// (folder name = slug, for scripts/upload-video.mjs):
//   - each take trimmed from its `ready` mark; the voice starts VO_LEAD later;
//   - captions burnt in (the clip's language; PNGs drawn by Chromium so Arabic
//     shapes and runs right-to-left, in the site's fonts when --base is up)
//     AND both languages as sidecar VTT;
//   - voice loudness-normalised (-16 LUFS) over a quiet music bed (music.mjs);
//   - H.264 + faststart and VP9/Opus, 1280x720, 30 fps; poster 1280x720.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const [lang, outRoot] = process.argv.slice(2);
const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
if (!["en", "ar"].includes(lang) || !outRoot) {
  console.error("Usage: node scripts/record-videos/cc/edit.mjs <en|ar> <outRoot> [--base URL] [--no-music]");
  process.exit(1);
}
const other = lang === "en" ? "ar" : "en";
const BASE = arg("base", "http://localhost:3100").replace(/\/+$/, "");
const MUSIC = !process.argv.includes("--no-music");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const VO_LEAD = 0.5; // = record.mjs
const W = 1280;
const H = 720;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(outRoot);
const work = path.join(root, lang);
const slug = `cc-intro-${lang}`;
const out = path.join(root, "videos", slug);
const tmp = path.join(work, "edit");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, "cues"), { recursive: true });
fs.mkdirSync(out, { recursive: true });

const spec = JSON.parse(fs.readFileSync(path.join(here, `script.${lang}.json`), "utf8"));
const marks = JSON.parse(fs.readFileSync(path.join(work, "raw", "marks.json"), "utf8"));
const timings = JSON.parse(fs.readFileSync(path.join(work, "vo", "timings.json"), "utf8"));
const otherTimings = JSON.parse(fs.readFileSync(path.join(root, other, "vo", "timings.json"), "utf8"));
const run = (args) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

// ── timeline ────────────────────────────────────────────────────────────────
let cursor = 0;
const segs = spec.segments.map((s) => {
  const m = marks[s.id];
  if (!m) throw new Error(`no take for ${s.id} (run record.mjs)`);
  const len = +(m.end - m.ready).toFixed(3);
  const seg = { id: s.id, ready: m.ready, len, start: cursor };
  cursor += len;
  return seg;
});
const total = cursor;

// ── captions ────────────────────────────────────────────────────────────────
const MAX = 84; // characters per cue (two lines at 30 px)
/** Split a long sentence at the comma (or " and" / " و") nearest its middle. */
function split(text) {
  if (text.length <= MAX) return [text];
  const mid = text.length / 2;
  let best = -1;
  const re = /[,،;]\s|\s(?:and|or|so|then|و|ثم)\s/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const at = m.index + (m[0].startsWith(" ") ? 0 : 1);
    if (best < 0 || Math.abs(at - mid) < Math.abs(best - mid)) best = at;
  }
  if (best < 0) {
    best = text.lastIndexOf(" ", mid);
    if (best < 0) return [text];
  }
  return [...split(text.slice(0, best).trim()), ...split(text.slice(best).trim())];
}
/** Sentences [{text,start,end}] (seconds from the voice start) -> cues, long ones split by length. */
function toCues(sentences, offset) {
  const cues = [];
  for (const s of sentences) {
    const parts = split(s.text);
    const n = parts.reduce((a, p) => a + p.length, 0);
    let t = s.start;
    for (const p of parts) {
      const d = ((s.end - s.start) * p.length) / n;
      cues.push({ text: p, start: offset + t, end: offset + t + d });
      t += d;
    }
  }
  return cues;
}
/** The other language's sentences spread over this clip's voice time, by length. */
function otherSentences(id, dur) {
  const sents = otherTimings[id]?.sentences ?? [];
  const n = sents.reduce((a, s) => a + s.text.length, 0) || 1;
  let t = 0;
  return sents.map((s) => {
    const d = (dur * s.text.length) / n;
    const r = { text: s.text, start: t, end: t + d };
    t += d;
    return r;
  });
}
function tidy(cues) {
  cues.sort((a, b) => a.start - b.start);
  cues.forEach((c, i) => {
    const next = cues[i + 1];
    const limit = next ? next.start - 0.04 : total;
    c.end = Math.min(Math.max(c.end + 0.35, c.start + 1.2), limit); // linger a little, never overlap
  });
  return cues;
}
const own = tidy(segs.flatMap((s) => toCues(timings[s.id].sentences, s.start + VO_LEAD)));
const second = tidy(segs.flatMap((s) => toCues(otherSentences(s.id, timings[s.id].duration), s.start + VO_LEAD)));

const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))}.${p(ms % 1000, 3)}`;
};
const vtt = (cues) => `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join("\n\n")}\n`;
fs.writeFileSync(path.join(out, `${slug}.${lang}.vtt`), vtt(own), "utf8");
fs.writeFileSync(path.join(out, `${slug}.${other}.vtt`), vtt(second), "utf8");

// ── burnt-in caption images (Chromium shapes Arabic; site fonts when up) ─────
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
let siteFonts = true;
try {
  const res = await page.goto(`${BASE}/cad-champions/${lang}/privacy`, { waitUntil: "networkidle", timeout: 30000 });
  if (!res?.ok()) throw new Error(String(res?.status()));
} catch {
  siteFonts = false;
  await page.setContent(`<html lang="${lang}" dir="${lang === "ar" ? "rtl" : "ltr"}"><body></body></html>`);
}
await page.evaluate((rtl) => {
  const st = document.createElement("style");
  st.textContent = `html,body{background:transparent !important}
    body > *{display:none !important}
    #__cap{display:flex !important;position:fixed;inset:0;align-items:flex-end;justify-content:center;padding-bottom:34px;z-index:2147483647}
    #__cap span{max-width:1060px;padding:9px 22px 11px;border-radius:14px;background:rgba(10,14,21,.80);color:#fff;
      font-size:31px;line-height:1.38;font-weight:600;text-align:center;letter-spacing:0;
      direction:${rtl ? "rtl" : "ltr"};font-family:inherit;box-shadow:0 2px 10px rgba(0,0,0,.25)}`;
  document.head.appendChild(st);
  const d = document.createElement("div");
  d.id = "__cap";
  d.innerHTML = "<span></span>";
  document.body.appendChild(d);
}, lang === "ar");
await page.evaluate(() => document.fonts.ready);
const list = [];
const blank = path.join(tmp, "cues", "blank.png");
await page.evaluate(() => {
  document.querySelector("#__cap").style.visibility = "hidden";
});
await page.screenshot({ path: blank, omitBackground: true });
await page.evaluate(() => {
  document.querySelector("#__cap").style.visibility = "visible";
});
let t = 0;
for (const [i, c] of own.entries()) {
  const file = path.join(tmp, "cues", `c${String(i).padStart(3, "0")}.png`);
  await page.evaluate((text) => {
    document.querySelector("#__cap span").textContent = text;
  }, c.text);
  await page.screenshot({ path: file, omitBackground: true });
  if (c.start > t) list.push(`file '${blank.replace(/\\/g, "/")}'\nduration ${(c.start - t).toFixed(3)}`);
  list.push(`file '${file.replace(/\\/g, "/")}'\nduration ${(c.end - c.start).toFixed(3)}`);
  t = c.end;
}
list.push(`file '${blank.replace(/\\/g, "/")}'\nduration ${Math.max(0.1, total - t).toFixed(3)}`);
list.push(`file '${blank.replace(/\\/g, "/")}'`); // concat demuxer: last entry repeated
await browser.close();
const capList = path.join(tmp, "captions.txt");
fs.writeFileSync(capList, list.join("\n") + "\n");

// ── audio: voice at its place + quiet bed, loudness-normalised ──────────────
const voInputs = segs.flatMap((s) => ["-i", path.join(work, "vo", `${s.id}.mp3`)]);
const delays = segs.map((s, i) => {
  const ms = Math.round((s.start + VO_LEAD) * 1000);
  return `[${i}:a]aresample=48000,aformat=channel_layouts=mono,adelay=${ms}:all=1[a${i}]`;
});
const voice = path.join(tmp, "voice.wav");
run([...voInputs, "-filter_complex",
  `${delays.join(";")};${segs.map((_, i) => `[a${i}]`).join("")}amix=inputs=${segs.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[v]`,
  "-map", "[v]", "-ar", "48000", "-ac", "1", voice]);
let mix = voice;
if (MUSIC) {
  const bed = path.join(tmp, "music.wav");
  execFileSync(process.execPath, [path.join(here, "..", "music.mjs"), bed, String(Math.ceil(total) + 1)], { stdio: "inherit" });
  mix = path.join(tmp, "mix.wav");
  run(["-i", voice, "-i", bed, "-filter_complex",
    "[1:a]volume=0.32,atrim=0:" + total.toFixed(3) + "[m];[0:a]aformat=channel_layouts=stereo[v];[v][m]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.89[a]",
    "-map", "[a]", "-ar", "48000", mix]);
}

// ── video ───────────────────────────────────────────────────────────────────
const vInputs = segs.flatMap((s) => ["-i", path.join(work, "raw", `${s.id}.webm`)]);
const n = segs.length;
const parts = segs.map((s, i) =>
  `[${i}:v]trim=start=${s.ready}:duration=${s.len},setpts=PTS-STARTPTS,fps=30,scale=${W}:${H}:flags=lanczos,setsar=1,format=yuv420p[v${i}]`);
const filter = [
  ...parts,
  `${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${n}:v=1:a=0[body]`,
  `[${n}:v]fps=30,format=rgba[cap]`,
  `[body][cap]overlay=0:0:format=auto:shortest=1,fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.7).toFixed(2)}:d=0.7,format=yuv420p[v]`,
  `[${n + 1}:a]afade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8[a]`,
].join(";");
const mp4 = path.join(out, `${slug}.mp4`);
const webm = path.join(out, `${slug}.webm`);
run([...vInputs, "-f", "concat", "-safe", "0", "-i", capList, "-i", mix, "-filter_complex", filter,
  "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
  "-c:v", "libx264", "-preset", "slow", "-crf", "25", "-tune", "animation", "-pix_fmt", "yuv420p", "-r", "30",
  "-c:a", "aac", "-b:a", "112k", "-movflags", "+faststart", mp4]);
run(["-i", mp4, "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "38", "-row-mt", "1", "-deadline", "good", "-cpu-used", "3",
  "-c:a", "libopus", "-b:a", "80k", webm]);
run(["-i", path.join(work, "raw", "poster.jpg"), "-vf", `scale=${W}:${H}:flags=lanczos`, "-q:v", "3", path.join(out, `${slug}.jpg`)]);

const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2);
console.log(`${slug}: ${total.toFixed(1)} s, mp4 ${mb(mp4)} MB, webm ${mb(webm)} MB, ${own.length} cues (${lang}) + ${second.length} (${other}), fonts ${siteFonts ? "site" : "system"}${MUSIC ? ", music bed" : ""}`);
