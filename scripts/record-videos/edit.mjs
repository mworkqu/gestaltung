// Cut a feature video from the recorder's raw takes and write the five files
// the site expects (P3-04).
//
//   node scripts/record-videos/edit.mjs <slug> <outRoot>
//
// Reads scripts/record-videos/cuts/<slug>.json:
//   sources:  raw takes, relative to <outRoot> (e.g. "idea-to-kit/raw.webm")
//   segments: [{ src, from, to, speed }]  source seconds; speed > 1 = faster
//   cues:     [{ src, at, en, ar }]       caption starts at that SOURCE time
//                                         (mapped through the cut); it ends
//                                         where the next cue starts
//   poster:   a 1280x720 JPG from the recorder, relative to <outRoot>
// Writes <outRoot>/final/<slug>/<slug>.{mp4,webm,jpg,en.vtt,ar.vtt}: H.264
// (+faststart) and VP9, 1280x720, 30 fps, silent, no burnt-in text — the
// captions are the VTT tracks only. ffmpeg: FFMPEG env, else PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [slug, outRoot] = process.argv.slice(2);
if (!slug || !outRoot) {
  console.error("Usage: node scripts/record-videos/edit.mjs <slug> <outRoot>");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(here, "cuts", `${slug}.json`), "utf8"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const root = path.resolve(outRoot);
const out = path.join(root, "final", slug); // folder name = slug, for upload-video.mjs
fs.mkdirSync(out, { recursive: true });

// ── timeline ────────────────────────────────────────────────────────────────
let cursor = 0;
const segs = spec.segments.map((s) => {
  const len = (s.to - s.from) / s.speed;
  const seg = { ...s, outStart: cursor, len };
  cursor += len;
  return seg;
});
const total = cursor;

function toOut(src, at) {
  const inSeg = segs.find((s) => s.src === src && at >= s.from && at <= s.to);
  if (inSeg) return inSeg.outStart + (at - inSeg.from) / inSeg.speed;
  // Not inside a kept part: the next kept part of that source.
  const next = segs.find((s) => s.src === src && s.from >= at);
  if (next) return next.outStart;
  throw new Error(`cue at ${src}:${at} is after the last segment of that source`);
}

const cues = spec.cues
  .map((c) => ({ ...c, start: Math.max(0, toOut(c.src, c.at)) }))
  .sort((a, b) => a.start - b.start);
cues.forEach((c, i) => {
  c.end = i + 1 < cues.length ? cues[i + 1].start - 0.05 : total;
});

const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
};
for (const lang of ["en", "ar"]) {
  const body = cues
    .map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c[lang]}`)
    .join("\n\n");
  fs.writeFileSync(path.join(out, `${slug}.${lang}.vtt`), `WEBVTT\n\n${body}\n`, "utf8");
}

// ── video ───────────────────────────────────────────────────────────────────
const inputs = spec.sources.flatMap((s) => ["-i", path.join(root, s)]);
const parts = segs.map(
  (s, i) => `[${s.src}:v]trim=start=${s.from}:end=${s.to},setpts=(PTS-STARTPTS)/${s.speed}[v${i}]`,
);
const fadeOut = Math.max(0, total - 0.6).toFixed(2);
const filter = [
  ...parts,
  `${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,` +
    `fps=30,scale=1280:720:flags=lanczos,setsar=1,format=yuv420p,` +
    `fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOut}:d=0.6[v]`,
].join(";");

const run = (args) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const mp4 = path.join(out, `${slug}.mp4`);
const webm = path.join(out, `${slug}.webm`);
run([...inputs, "-filter_complex", filter, "-map", "[v]", "-an",
  "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
run(["-i", mp4, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1",
  "-deadline", "good", "-cpu-used", "2", webm]);

// Poster: re-encode the recorder's screenshot at 1280x720.
run(["-i", path.join(root, spec.poster), "-vf", "scale=1280:720:flags=lanczos", "-q:v", "3", path.join(out, `${slug}.jpg`)]);

const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2);
console.log(`${slug}: ${total.toFixed(1)} s, mp4 ${mb(mp4)} MB, webm ${mb(webm)} MB, ${cues.length} cues`);
for (const c of cues) console.log(`  ${stamp(c.start)} ${c.en}`);
