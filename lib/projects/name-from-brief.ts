// A project name from its brief (P1-11 / CC-1). /api/projects/name calls this
// once, right after a project is created from the chat, while the project is
// still called "New project". The model call is injected so tests need no
// network and no mocks. Any failure leaves the placeholder name (null).

import { DEFAULT_PROJECT_NAME } from "@/lib/projects/create-from-chat";

export const MAX_PROJECT_NAME = 60;

/** Gemini response schema: just the name. */
export const NAME_SCHEMA = {
  type: "OBJECT",
  properties: { name: { type: "STRING" } },
  required: ["name"],
};

export type NamePrompt = { system: string; prompt: string };

export function buildNamePrompt(brief: string, locale: "en" | "ar"): NamePrompt {
  return {
    system:
      "You name a customer's product project from their description. " +
      "Return a short, plain project name of 3 to 6 words that says what the product is. " +
      "No quotes, no trailing punctuation, no emoji, no brand names unless the customer used one. " +
      `Write it in ${locale === "ar" ? "Arabic (use Western digits 0-9)" : "English"}.`,
    prompt: `Project description:\n${brief.trim().slice(0, 3000)}`,
  };
}

// Straight and curly quotes, backticks, guillemets.
const QUOTES = /["'`‘’“”«»‹›]/g;
// Punctuation that may lead or trail a name (Latin and Arabic).
const EDGE = "\\s.,;:!?\\u060C\\u061B\\u061F\\u06D4\\-\\u2013\\u2014*_#()\\[\\]{}";
const EDGE_PUNCT = new RegExp(`^[${EDGE}]+|[${EDGE}]+$`, "g");
const PLACEHOLDERS = new Set(
  [DEFAULT_PROJECT_NAME, "project", "untitled", "untitled project", "name", "project name", "مشروع", "مشروع جديد"].map(
    (s) => s.toLowerCase()
  )
);

/**
 * Tidies a model's name: no quotes, no edge punctuation, single spaces, at
 * most 60 characters (cut on a word). Empty or placeholder → `fallback`.
 */
export function cleanProjectName(raw: unknown, fallback: string | null): string | null {
  if (typeof raw !== "string") return fallback;
  let s = raw.replace(QUOTES, "").replace(/\s+/g, " ").replace(EDGE_PUNCT, "").trim();
  if (s.length > MAX_PROJECT_NAME) {
    s = s.slice(0, MAX_PROJECT_NAME);
    const cut = s.lastIndexOf(" ");
    if (cut >= 20) s = s.slice(0, cut);
    s = s.replace(EDGE_PUNCT, "").trim();
  }
  if (!s || PLACEHOLDERS.has(s.toLowerCase())) return fallback;
  return s;
}

/** Asks the injected model for a name; resolves null on an empty brief or any failure. */
export async function generateProjectName({
  brief,
  locale,
  call,
}: {
  brief: string | null | undefined;
  locale: "en" | "ar";
  call: (p: NamePrompt) => Promise<unknown>;
}): Promise<string | null> {
  if (!brief?.trim()) return null;
  try {
    const raw = await call(buildNamePrompt(brief, locale));
    const name = raw && typeof raw === "object" ? (raw as { name?: unknown }).name : raw;
    return cleanProjectName(name, null);
  } catch {
    return null;
  }
}
