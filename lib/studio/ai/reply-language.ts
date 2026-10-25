// F-047: the chat reply follows the language the visitor WROTE in, not the page's.
// Only the conversational reply (and the question before the card) mirrors; the card,
// its names and its features stay in the page language so the spec never changes with a message.

export type ReplyLocale = "en" | "ar";

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g;
const LATIN = /[A-Za-z]/g;

/** "ar" / "en" when the text is clearly one script; `fallback` for digits, emoji or a tie. */
export function replyLanguage(text: string, fallback: ReplyLocale): ReplyLocale {
  const ar = (text.match(ARABIC) ?? []).length;
  const en = (text.match(LATIN) ?? []).length;
  if (ar === en) return fallback;
  return ar > en ? "ar" : "en";
}

/** The newest thing the visitor wrote (the idea itself on the very first turn). */
export function newestUserText(idea: string, messages: readonly { role: string; text: string }[]): string {
  return [...messages].reverse().find((m) => m.role === "user")?.text || idea;
}
