// Text normalisation for search and matching. Pure, safe in the browser.
//
// normalizeText is the former lib/store/search.ts function (that file re-exports
// it): NFKD, Latin accents and Arabic tashkeel/tatweel stripped, alef/ya/ta-marbuta
// folded, Arabic-Indic digits to Western, lower case. The three part-matching engines keep their own matchers and stop-word
// lists (CODE_QUALITY_AUDIT D-27); only this normaliser and the word splitter
// are shared.

/** Lower-case, no Latin accents, Arabic without tashkeel/tatweel, one alef/ya/ta marbuta form, Western digits. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase();
}

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Normalised words (letters and digits, any script) of `text`, in order and not
 * de-duplicated. Words in `stopwords` are dropped; the list is normalised the
 * same way first, so "THE" or an un-folded Arabic form still matches.
 */
export function tokenize(text: string, stopwords?: Iterable<string>): string[] {
  const words = normalizeText(text).match(WORD) ?? [];
  if (!stopwords) return words;
  const stop = new Set<string>();
  for (const w of stopwords) stop.add(normalizeText(w));
  return words.filter((w) => !stop.has(w));
}
