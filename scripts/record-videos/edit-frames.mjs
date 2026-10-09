// Build a feature video from a few step-by-step screenshots (GIF frames) —
// used for wiring-check and cad-model, recorded from the owner's signed-in
// Chrome (P3-04).
//
//   node scripts/record-videos/edit-frames.mjs <slug> <outRoot> [<raw.gif>]
//
// Reads scripts/record-videos/frames/<slug>.json:
//   frames: [{ file, hold }]  kept frames (names from the GIF extraction), hold
//                             in seconds; consecutive frames cross-fade 0.5 s
//   poster: frame file used for the 1280x720 JPG
//   cues:   [{ frame, at, en, ar }]  caption starts `at` s into that frame's
//                                    slot; it ends where the next cue starts
// If <raw.gif> is given and <outRoot>/<slug>/frames/ is empty, the GIF is
// split there first (frame_NN.png). Each frame is scaled to width 1280 and
// padded to 1280x720 on the site background #eef2f7, then given a slow 4 %
// zoom (zoompan). Writes <outRoot>/final/<slug>/<slug>.{mp4,webm,jpg,en.vtt,
// ar.vtt}: H.264 (+faststart) and VP9, 30 fps, silent, no burnt-in text.
// ffmpeg: FFMPEG env, else PATH.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [slug, outRoot, gif] = process.argv.slice(2);
if (!slug || !outRoot) {
  console.error("Usage: node scripts/record-videos/edit-frames.mjs <slug> <outRoot> [<raw.gif>]");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(fs.readFileSync(path.join(here, "frames", `${slug}.json`), "utf8"));
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const root = path.resolve(outRoot);
const framesDir = path.join(root, slug, "frames");
const out = path.join(root, "final", slug); // folder name = slug, for upload-video.mjs
fs.mkdirSync(framesDir, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const run = (args) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });

if (gif && fs.readdirSync(framesDir).length === 0) {
  run(["-i", path.resolve(gif), "-fps_mode", "passthrough", path.join(framesDir, "frame_%02d.png")]);
}

const FADE = 0.5;
const FPS = 30;
const W = 1280;
const H = 720;
const BG = "0xeef2f7";
const n = spec.frames.length;

// Frame k starts at sum(hold_j - FADE, j < k); the clip lasts sum(hold) - FADE*(n-1).
const starts = [];
let cursor = 0;
for (const f of spec.frames) {
  starts.push(cursor);
  cursor += f.hold - FADE;
}
const total = cursor + FADE;

// ── captions ────────────────────────────────────────────────────────────────
const cues = spec.cues.map((c) => ({ ...c, start: starts[c.frame] + c.at })).sort((a, b) => a.start - b.start);
cues.forEach((c, i) => {
  c.end = i + 1 < cues.length ? cues[i + 1].start - 0.05 : total;
});
const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const pad = (v, w = 2) => String(v).padStart(w, "0");
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(ms % 1000, 3)}`;
};
for (const lang of ["en", "ar"]) {
  const body = cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c[lang]}`).join("\n\n");
  fs.writeFileSync(path.join(out, `${slug}.${lang}.vtt`), `WEBVTT\n\n${body}\n`, "utf8");
}

// ── video ───────────────────────────────────────────────────────────────────
// Scale to width 1280 and centre-pad to 1280x720 on the page background.
const fit = `scale=${W}:-2:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${BG}`;
const inputs = spec.frames.flatMap((f) => [
  "-loop", "1", "-framerate", String(FPS), "-t", String(f.hold + 0.1), "-i", path.join(framesDir, f.file),
]);
const chains = spec.frames.map((f, i) => {
  const frames = Math.ceil((f.hold + 0.1) * FPS);
  // 2x upscale before zoompan avoids sub-pixel jitter; zoom 1 -> 1.04 over the hold.
  return (
    `[${i}:v]${fit},scale=${W * 2}:${H * 2}:flags=lanczos,` +
    `zoompan=z='1+0.04*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS},` +
    `setsar=1,format=yuv420p[z${i}]`
  );
});
let prev = "z0";
const xf = [];
let acc = spec.frames[0].hold;
for (let i = 1; i < n; i++) {
  const offset = (acc - FADE).toFixed(3);
  const label = i === n - 1 ? "x" : `x${i}`;
  xf.push(`[${prev}][z${i}]xfade=transition=fade:duration=${FADE}:offset=${offset}[${label}]`);
  prev = label;
  acc += spec.frames[i].hold - FADE;
}
const fadeOut = (total - 0.6).toFixed(2);
const filter = [
  ...chains,
  ...xf,
  `[x]trim=duration=${total.toFixed(3)},fade=t=in:st=0:d=0.4,fade=t=out:st=${fadeOut}:d=0.6,setpts=PTS-STARTPTS[v]`,
].join(";");

const mp4 = path.join(out, `${slug}.mp4`);
const webm = path.join(out, `${slug}.webm`);
run([...inputs, "-filter_complex", filter, "-map", "[v]", "-an",
  "-c:v", "libx264", "-preset", "slow", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
run(["-i", mp4, "-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1",
  "-deadline", "good", "-cpu-used", "2", webm]);
run(["-i", path.join(framesDir, spec.poster), "-vf", fit, "-frames:v", "1", "-q:v", "3", path.join(out, `${slug}.jpg`)]);

const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(2);
console.log(`${slug}: ${total.toFixed(1)} s, mp4 ${mb(mp4)} MB, webm ${mb(webm)} MB, ${cues.length} cues`);
for (const c of cues) console.log(`  ${stamp(c.start)} ${c.en}`);
