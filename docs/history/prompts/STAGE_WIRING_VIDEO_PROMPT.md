# STAGE — "Wiring in the Studio" feature video (English first, Arabic after)

Read CLAUDE.md first: FEATURE VIDEOS (P3-04), WIRING VIEWS + CODE LINK (P5-17, incl. 17e breadboard,
17f neat wiring, 17g Try it, 17h pin names) and the existing video tools in scripts/record-videos/
(record.mjs, edit.mjs, edit-frames.mjs, tts.mjs, music.mjs, youtube.mjs, cuts/youtube-ar.json,
voice/youtube-ar.txt). Reuse them; extend only where needed. Do the ENGLISH video in this stage. Stop after
it and show me; the Arabic one is Part E and runs only when I say "go Arabic".

## Goal

One 75–100 s English YouTube video (1920x1080, voice-over, soft music, captions burnt in) that shows off
the Wiring step, plus a ≤ 45 s cut for the site (no voice, VTT captions) that replaces/sits beside
`wiring-check`. Tone: calm, confident, plain English, no hype words ("revolutionary", "magic").
Every claim must be something the clip shows. Never say "free" for wiring (each circuit costs one credit),
never promise reprints, never mention partner workshops.

## Features to show (in this order — the story is "from parts to a working circuit")

1. Parts → Wiring: the circuit is drawn for you (Wiring tab: board in the centre, colour-coded wires,
   red power / black ground). Hover a wire → both ends light up; "X → Y (colour)" line.
2. Same circuit, four views: Wiring · 3D · Schematic · Pin list — select a wire in one, it stays selected
   in the others.
3. 3D breadboard: a real prototype build — parts plugged into the breadboard, neat jumper wires routed
   along the grid; drag a part and the wires re-route live; zoom in → pin names appear on the boards.
4. Take it apart (exploded view) in 3D.
5. Try it: the behaviour preview — move the soil slider, the pump turns on, wires light up with moving
   beads; press-and-hold a button. Keep the on-screen note "A preview of how it behaves" visible.
6. Plain safety checks: the line that says what the checker fixed (e.g. resistor added for the LED,
   driver for the pump) — show it, don't explain the electronics.
7. Build guide: "Wire 3 of 8: yellow from D2 to LED +", Next, Mark as done; Pin list tick boxes + Print.
8. Code link: Code step, pin constants tinted; hover a pin line → wire preview; "Show in wiring" jumps back
   and highlights that wire. Change a part → "Pins updated".
9. Wokwi export (only on a project where the button exists — an Uno/ESP32 DevKit project, NOT the plant
   waterer with the C3 mini) — show the button and the downloaded zip name; don't open Wokwi.
10. End card: "Plan your product at gestaltung360.com".

## How to record (no production writes)

- Record from a LOCAL production build with E2E_FIXTURES=1 using the Studio fixture
  (`/en/e2e-fixtures/studio?idea=…&step=wiring`, mocked API — see e2e/studio-wiring-views.spec.ts and
  lib/e2e-fixtures.ts). Use two fixture projects: plant waterer (pump + soil, best for Try it) and one on
  an ESP32 DevKit or Uno for the Wokwi button (add a fixture idea if none exists — fixture only).
  Nothing may be written to production Supabase; the e2e write guard pattern (e2e/fixtures.ts) should be
  active during recording. If a feature can't be reached in the fixture, tell me instead of using live.
- Extend record.mjs with a `wiring-tour` take list (Playwright, 1920x1080, deviceScaleFactor 1, cursor dot
  + ripple as today, slow deliberate mouse moves, 1–1.5 s pauses on each result, cookie banner declined,
  reduced-motion OFF so 3D/Try it animate, GPU flags so WebGL renders smoothly). One take per feature so
  bad takes can be redone alone. Hide the fixture's test-only UI if any.
- Write scripts/record-videos/voice/wiring-en.txt: one line per segment, 10–14 lines, each ≤ 18 words,
  ~140 words per minute total. Example opening: "Your parts are picked. Now the circuit draws itself —
  every wire, colour-coded." Show me the script BEFORE generating voice.
- Voice: tts.mjs (Gemini TTS free tier, ~10 requests/day — use --only to redo single lines; pick an
  English voice that sounds natural, try 2 and let me choose). Music: music.mjs, dipped under the voice.
- Plan: scripts/record-videos/cuts/youtube-en.json (same format as youtube-ar.json: intro card, segments
  with vo line + `at`, outro). Build with youtube.mjs → final/youtube-en.mp4. Captions = the spoken line.
- Site cut: edit.mjs + cuts/wiring-tour.json → ≤ 45 s, no audio, H.264 faststart + VP9, poster 1280x720,
  wiring-tour.en.vtt. Add slug `wiring-tour` to lib/videos.ts (published:false until I approve),
  Videos.* copy in EN + AR (AR caption file comes in Part E; until then AR shows the poster), and place it
  on the Studio Wiring step empty state + /how-it-works "Plan" path if it fits the layout. Update tests.

## Checks before showing me

- Watch the final file frame by frame at the joins (ffmpeg thumbnails every 2 s into a contact sheet);
  no cookie banner, no dev overlay, no "Fixture" text, no stuck spinner, no cut-off labels, text readable
  at 1080p, voice never talks over a different feature than the one on screen.
- Duration, loudness (−14 LUFS integrated, ffmpeg loudnorm), file size.
- Send me: the contact sheet, the script, the MP4 path. Do NOT upload to Supabase or YouTube yet.

## After I approve (still this stage)

- Upload the site cut with scripts/upload-video.mjs, set published + uploadDate in lib/videos.ts.
- YouTube: use Dashboard → Store → YouTube links upload (Private by default) or give me the file +
  title/description/chapters (timestamps per feature) to upload myself.

## Part E — Arabic version (only when I say "go Arabic")

- Record the same takes on /ar (RTL UI, Arabic labels and pin-name tags) — not the English footage.
- voice/wiring-ar.txt written natively in Modern Standard Arabic, short sentences, Western digits for
  numbers, product terms the site already uses (مخطط التوصيل، لوحة التجارب، القطع). Show me first.
- tts.mjs with the voice used for idea-to-product-ar (consistency), cuts/youtube-wiring-ar.json,
  youtube.mjs (RTL captions via libass, Arabic brand name). Site cut wiring-tour.ar.vtt.
- Same checks; then the same approve → upload flow.
