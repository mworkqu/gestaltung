// Voice-over lines with Gemini text-to-speech (free tier, GEMINI_API_KEY from
// .env.local). One WAV per line of the script file: vo1.wav, vo2.wav, …
//
//   node scripts/record-videos/tts.mjs scripts/record-videos/voice/youtube-ar.txt <outDir> [--voice Charon] [--only 3,7]
//
// Free tier is ~10 requests/day per TTS model, so it falls through
// TTS_MODELS in order on a 429. Send ONLY the line: any style instruction in
// the text is read aloud too.
import fs from "node:fs";
import path from "node:path";

const [scriptFile, outDir] = process.argv.slice(2);
const opt = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
if (!scriptFile || !outDir) {
  console.error("Usage: node scripts/record-videos/tts.mjs <script.txt> <outDir> [--voice Charon] [--only 1,2]");
  process.exit(1);
}
const voice = opt("voice", "Charon");
const only = opt("only", "") ? new Set(opt("only").split(",").map(Number)) : null;
const TTS_MODELS = ["gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const key = (process.env.GEMINI_API_KEY ||
  fs.readFileSync(".env.local", "utf8").match(/^GEMINI_API_KEY=(.*)$/m)?.[1] || "").trim().replace(/^"|"$/g, "");
if (!key) throw new Error("GEMINI_API_KEY missing");
fs.mkdirSync(outDir, { recursive: true });

function wav(pcm) { // 24 kHz, 16-bit, mono
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const lines = fs.readFileSync(scriptFile, "utf8").split(/\r?\n/).filter((l) => l.trim());
for (const [i, text] of lines.entries()) {
  const n = i + 1;
  if (only && !only.has(n)) continue;
  let done = false;
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
    if (!part) { console.warn(`vo${n} ${model}: ${r.status}`); continue; }
    const pcm = Buffer.from(part.inlineData.data, "base64");
    fs.writeFileSync(path.join(outDir, `vo${n}.wav`), wav(pcm));
    console.log(`vo${n} ${(pcm.length / 48000).toFixed(2)} s (${model})`);
    done = true;
    break;
  }
  if (!done) { console.error(`vo${n}: every model refused (daily quota?)`); process.exitCode = 1; }
}
