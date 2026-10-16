// Give the silent site clips a voice-over + music, one file per language.
//
//   node scripts/record-videos/voice-clips.mjs <clipDir> <outDir> [--slugs a,b] [--langs ar,en] [--voice Charon]
//
// <clipDir> holds <slug>.mp4 + <slug>.<lang>.vtt (the site's files). For each
// slug and language the caption lines are read by Gemini TTS in ONE take (same
// voice and pace throughout; the take is cached as <slug>.<lang>.take.wav so a
// re-run spends no quota), split at its N-1 longest pauses, and each line is
// placed at its caption's start (sped up to 1.3x when it would run into the
// next line). Music from music.mjs dips under the voice. The video stream is
// copied unchanged. Writes <outDir>/<slug>.<lang>.mp4.
// Run from the project root (reads GEMINI_API_KEY from .env.local).
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [clipDir, outDir] = process.argv.slice(2);
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
if (!clipDir || !outDir) {
  console.error("Usage: node scripts/record-videos/voice-clips.mjs <clipDir> <outDir> [--slugs a,b] [--langs ar,en] [--voice Charon]");
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const slugs = opt("slugs", "idea-to-kit,file-to-part,sketch-to-drawing,wiring-check,cad-model,store-to-door").split(",");
const langs = opt("langs", "ar,en").split(",");
const voice = opt("voice", "Charon");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const FFPROBE = process.env.FFPROBE || "ffprobe";
const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const key = (process.env.GEMINI_API_KEY ||
  fs.readFileSync(".env.local", "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1] || "").trim().replace(/^"|"$/g, "");
fs.mkdirSync(outDir, { recursive: true });

const ff = (args) => execFileSync(FFMPEG, ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
const dur = (f) => parseFloat(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());
const secs = (s) => { const [h, m, r] = s.trim().split(":"); return +h * 3600 + +m * 60 + +r; };

function cuesOf(file) {
  return fs.readFileSync(file, "utf8").split(/\r?\n\r?\n/).map((b) => b.split(/\r?\n/))
    .filter((l) => l.some((x) => x.includes("-->")))
    .map((l) => {
      const i = l.findIndex((x) => x.includes("-->"));
      const [a, b] = l[i].split("-->");
      return { start: secs(a), end: secs(b), text: l.slice(i + 1).join(" ").trim() };
    });
}

async function synth(text, out) {
  for (const model of TTS_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
      }),
    });
    const j = await r.json().catch(() => ({}));
    const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) { console.warn(`  ${model}: ${r.status}`); continue; }
    const pcm = Buffer.from(part.inlineData.data, "base64"); // 24 kHz s16le mono
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
    h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(out, Buffer.concat([h, pcm]));
    return model;
  }
  throw new Error("every TTS model refused (daily quota?)");
}

/** ffmpeg's stderr (silencedetect writes there). */
const stderrOf = (args) => spawnSync(FFMPEG, args, { encoding: "utf8" }).stderr || "";

for (const slug of slugs) {
  const video = path.join(clipDir, `${slug}.mp4`);
  const total = dur(video);
  for (const lang of langs) {
    const cues = cuesOf(path.join(clipDir, `${slug}.${lang}.vtt`));
    const tag = `${slug}.${lang}`;
    const take = path.join(outDir, `${tag}.take.wav`);
    if (!fs.existsSync(take)) {
      const model = await synth(cues.map((c) => c.text).join("\n\n"), take);
      console.log(`${tag}: take ${dur(take).toFixed(1)} s (${model})`);
    }
    // Split at the N-1 longest pauses, in time order.
    const log = stderrOf(["-hide_banner", "-i", take, "-af", "silencedetect=n=-40dB:d=0.25", "-f", "null", "-"]);
    const gaps = [];
    let s0 = null;
    for (const m of log.matchAll(/silence_(start|end): ([\d.]+)/g)) {
      if (m[1] === "start") s0 = +m[2];
      else if (s0 !== null) { gaps.push({ start: s0, end: +m[2] }); s0 = null; }
    }
    const takeLen = dur(take);
    const inner = gaps.filter((g) => g.start > 0.2 && g.end < takeLen - 0.2);
    if (inner.length < cues.length - 1) throw new Error(`${tag}: ${inner.length} pauses for ${cues.length} lines`);
    const cuts = inner.sort((a, b) => b.end - b.start - (a.end - a.start)).slice(0, cues.length - 1)
      .map((g) => (g.start + g.end) / 2).sort((a, b) => a - b);
    const bounds = [0, ...cuts, takeLen];
    // Place each line; speed up (max 1.3x) or push later when it would overlap.
    const parts = [];
    let free = 0;
    for (let i = 0; i < cues.length; i++) {
      const f = path.join(outDir, `${tag}.${i + 1}.wav`);
      ff(["-i", take, "-ss", String(bounds[i]), "-to", String(bounds[i + 1]), "-af",
        "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", f]);
      let len = dur(f);
      const start = Math.max(cues[i].start + 0.2, free);
      const nextStart = i + 1 < cues.length ? cues[i + 1].start + 0.2 : total - 0.3;
      const room = nextStart - start - 0.15;
      let tempo = 1;
      if (len > room && room > 0) tempo = Math.min(1.3, len / room);
      len /= tempo;
      parts.push({ f, start, tempo });
      free = start + len + 0.15;
    }
    // A last line that runs past the end: hold the last frame until it is said.
    const end = Math.max(total, free + 0.6);
    const hold = end - total;
    // Music bed + mix, video copied.
    const music = path.join(outDir, `music-${Math.ceil(end)}.wav`);
    if (!fs.existsSync(music)) execFileSync(process.execPath, [path.join(here, "music.mjs"), music, String(Math.ceil(end) + 1)], { stdio: "inherit" });
    const inputs = parts.flatMap((p) => ["-i", p.f]);
    const voiceChains = parts.map((p, i) => {
      const ms = Math.round(p.start * 1000);
      return `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,${p.tempo > 1 ? `atempo=${p.tempo.toFixed(3)},` : ""}volume=1.6,adelay=${ms}|${ms}[a${i}]`;
    });
    const m = parts.length + 1;
    const filter = [
      ...voiceChains,
      `${parts.map((_, i) => `[a${i}]`).join("")}amix=inputs=${parts.length}:normalize=0:duration=longest,apad=whole_dur=${end.toFixed(2)},asplit=2[voice][key]`,
      `[${m}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${end.toFixed(2)},volume=0.55,afade=t=out:st=${Math.max(0, end - 1.5).toFixed(2)}:d=1.5[mus]`,
      `[mus][key]sidechaincompress=threshold=0.03:ratio=6:attack=40:release=500[duck]`,
      `[voice][duck]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5,alimiter=limit=0.84:level=false,atrim=0:${end.toFixed(2)}[a]`,
    ].join(";");
    const out = path.join(outDir, `${tag}.mp4`);
    const vid = hold > 0
      ? ["-filter_complex", `[0:v]tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}[v];${filter}`, "-map", "[v]", "-map", "[a]",
        "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p"]
      : ["-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy"];
    ff(["-i", video, ...inputs, "-i", music, ...vid,
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", "-t", end.toFixed(2), out]);
    for (const p of parts) fs.rmSync(p.f, { force: true });
    console.log(`${tag}.mp4: ${end.toFixed(1)} s${hold > 0 ? ` (last frame held ${hold.toFixed(1)} s)` : ""}, ${parts.length} lines${parts.some((p) => p.tempo > 1) ? ", sped up: " + parts.map((p, i) => (p.tempo > 1 ? `${i + 1}×${p.tempo.toFixed(2)}` : null)).filter(Boolean).join(" ") : ""}`);
  }
}
