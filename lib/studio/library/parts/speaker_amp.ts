import type { LibraryPart } from "../../schema";

// 28 mm speaker with a PAM8403-style 2 x 3 W amplifier board (one channel used). The board feeds
// from 2.5-5.5 V; audio comes from a PWM/DAC pin on IN. Speaker looks toward +z.
export const speakerAmp: LibraryPart = {
  id: "speaker_amp",
  name: { en: "Speaker with amplifier", ar: "سماعة مع مكبّر صوت" },
  blurb: {
    en: "Plays tones and simple sounds loud enough to hear across a room.",
    ar: "تشغّل نغمات وأصواتاً بسيطة بصوت يُسمع في أرجاء الغرفة.",
  },
  category: "output",
  storeSkus: [],
  tags: ["speaker", "amplifier", "amp", "audio", "sound", "music", "voice", "tone", "pam8403", "pwm", "melody", "alarm", "announce", "output", "loud"],
  dims: { x: 50, y: 28, z: 7.5 },
  model: { kind: "procedural", builder: "speakerAmp", params: { spkR: 14 } },
  look: { body: "pcb_blue" },
  mount: null,
  ports: [{ kind: "speaker_grille", face: "+z", at: { u: 0.72, v: 0.5 }, size: { w: 24, h: 24 } }],
  pins: [
    { id: "VCC", label: "VCC (2.5-5.5 V)", role: "vin", side: "left" },
    { id: "GND", label: "GND", role: "gnd", voltage: 0, side: "left" },
    { id: "IN", label: "IN (audio from a pin)", role: "in", voltage: 3.3, side: "left" },
  ],
  power: { vMin: 2.5, vMax: 5.5, logicV: 5, mA: 300 },
  clearance: 1.5,
};
