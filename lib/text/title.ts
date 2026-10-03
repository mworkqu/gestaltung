// Short display form of a product title for cards.

export const ARABIC_CARD_TITLE_MAX = 80;

/**
 * Cuts `text` to at most `max` characters at a word boundary and adds "…".
 * Text that already fits is returned unchanged. A single word longer than
 * `max` is cut at `max`. The caller keeps the full title in title/aria-label.
 */
export function truncateAtWord(text: string, max = ARABIC_CARD_TITLE_MAX): string {
  const s = text.trim();
  if (max < 1 || s.length <= max) return s;
  const window = s.slice(0, max);
  // Prefer a cut at a space, unless that would throw away more than half.
  const space = window.lastIndexOf(" ");
  let cut = space >= max / 2 ? window.slice(0, space) : window;
  cut = cut.replace(/[\s\-–—_.,;:/+،؛]+$/u, "");
  return `${cut}…`;
}
