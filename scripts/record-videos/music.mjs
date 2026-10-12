// A soft background track made from scratch with ffmpeg (no samples, no
// licence): a warm pad, a low bass and a gentle plucked arpeggio over
// Am – F – C – G, 4 s per chord, looped to the requested length.
//
//   node scripts/record-videos/music.mjs <out.wav> <seconds>
import { execFileSync } from "node:child_process";

const [out, secondsArg] = process.argv.slice(2);
if (!out || !secondsArg) {
  console.error("Usage: node scripts/record-videos/music.mjs <out.wav> <seconds>");
  process.exit(1);
}
const seconds = Number(secondsArg);
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const BAR = 4; // seconds per chord
// [pad notes], bass, [arpeggio notes]
const CHORDS = [
  [[220, 261.63, 329.63], 110, [440, 523.25, 659.25, 523.25]], // Am
  [[174.61, 220, 261.63], 87.31, [349.23, 440, 523.25, 440]], // F
  [[261.63, 329.63, 392], 130.81, [523.25, 659.25, 783.99, 659.25]], // C
  [[196, 246.94, 293.66], 98, [392, 493.88, 587.33, 493.88]], // G
];
const LOOP = BAR * CHORDS.length;

// Which chord is playing at time t (as nested if()s).
const pick = (vals) => vals.reduceRight((acc, v, i) => `if(eq(floor(mod(t,${LOOP})/${BAR}),${i}),${v},${acc})`, "0");
// Swell that is 0 at every chord change, so the switch never clicks.
const swell = `sin(PI*mod(t,${BAR})/${BAR})`;
const pad = [0, 1, 2]
  .map((k) => `sin(2*PI*${pick(CHORDS.map((c) => c[0][k]))}*t)+0.35*sin(4*PI*${pick(CHORDS.map((c) => c[0][k]))}*t)`)
  .join("+");
const bass = `sin(2*PI*${pick(CHORDS.map((c) => c[1]))}*t)`;
// Arpeggio: a note every 0.5 s, four per bar shape repeated, decaying like a pluck.
const arpNote = (k) => pick(CHORDS.map((c) => c[2][k]));
const arpF = `if(eq(mod(floor(t*2),4),0),${arpNote(0)},if(eq(mod(floor(t*2),4),1),${arpNote(1)},if(eq(mod(floor(t*2),4),2),${arpNote(2)},${arpNote(3)})))`;
const arp = `sin(2*PI*${arpF}*t)*exp(-7*mod(t,0.5))*min(1,mod(t,0.5)*200)`;
const expr = `0.05*(${pad})*${swell}+0.11*${bass}*${swell}+0.07*${arp}`;
const fade = Math.max(0, seconds - 3);
execFileSync(FFMPEG, [
  "-y", "-hide_banner", "-loglevel", "error",
  "-f", "lavfi", "-i", `aevalsrc=${expr.replace(/,/g, "\\,")}:s=48000:d=${seconds}`, // commas escaped for the filter parser
  "-af", [
    "lowpass=f=2400",
    "aecho=0.8:0.7:120|260:0.3|0.2", // room
    "highpass=f=40",
    "pan=stereo|c0=c0|c1=c0",
    "aphaser=in_gain=0.6:out_gain=0.9:delay=3:decay=0.3:speed=0.2",
    `afade=t=in:d=2,afade=t=out:st=${fade}:d=3`,
    "loudnorm=I=-24:TP=-3",
  ].join(","),
  "-ar", "48000", out,
], { stdio: "inherit" });
console.log(`${out}: ${seconds} s`);
