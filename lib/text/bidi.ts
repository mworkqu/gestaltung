// Direction isolation for mixed Arabic / Latin text (product titles).
//
// In an RTL paragraph, a Latin part number or brand ("ESP32-S3", "Bluetooth")
// sits between neutral characters and the bidi algorithm can reorder it or let
// a trailing "-" / "." jump to the wrong side. Wrapping each Latin run in its
// own <bdi dir="ltr"> fixes that. This file only finds the runs; the React
// wrapper is components/ltr-isolate.tsx.

export type BidiRun = { text: string; ltr: boolean };

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;

/** True when the string contains at least one Arabic-script letter. */
export function hasArabic(text: string): boolean {
  return ARABIC.test(text);
}

// A Latin/digit run: letters and digits, joined by - . _ / + × * : % # & ' ° or
// a single space between Latin words ("Arduino Uno R3", "ESP32-S3 DevKit",
// "5V", "10mm", "20×4"). A joiner only counts when another letter/digit follows,
// so a sentence-final "." or a lone "-" stays outside. "+", "%", "°", "#" may
// trail a run ("C++", "5%", "90°").
const A = "[A-Za-z0-9\u00C0-\u024F]";
const J = "[-._/+\u00D7*:%#&'\u2019\u00B0]";
const LATIN_RUN = new RegExp(`${A}+(?:(?:${J}+| )${A}+)*[+%\u00B0#]?`, "g");

/**
 * Splits text into alternating runs. Latin/digit runs are `ltr: true`; the
 * text between them (Arabic, spaces, punctuation) is `ltr: false`.
 * Concatenating every run's `text` gives back the input exactly.
 */
export function splitBidiRuns(text: string): BidiRun[] {
  if (!text) return [];
  const runs: BidiRun[] = [];
  let last = 0;
  for (const m of text.matchAll(LATIN_RUN)) {
    const start = m.index ?? 0;
    if (start > last) runs.push({ text: text.slice(last, start), ltr: false });
    runs.push({ text: m[0], ltr: true });
    last = start + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), ltr: false });
  return runs;
}
