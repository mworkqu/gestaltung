// "Is this still the same product?" — pure, and deliberately reluctant.
//
// Refining an idea is free however many turns it takes (owner, 2026-10-25). Only a
// turn that replaces the product with a DIFFERENT product is charged as a new idea.
// A false positive takes money from someone who was only refining, so this file is
// built to say "same product" whenever it is not sure:
//
//   newIdeaTurn() returns true only when BOTH agree
//     1. the model says the newest message replaces the product (its `newProduct`
//        hint on the same turn — no second AI call), AND
//     2. our own reading of the IDENTITY fields (name, one-liner, the
//        understanding's goal) finds almost nothing in common with the old card.
//
// Parts, features, sensors, size, power, materials and style are NOT identity:
// "add a status light", "make it battery powered", "the tank holds 2 litres" never
// read as a new product, whatever the model says. Only what the thing IS counts.
//
// The price of a new idea is then the new product's tier (lib/studio/tiers.ts) and
// it still goes through the approval checkpoint, so nothing is ever deducted
// without the visitor seeing the amount first.

import { stableHash } from "./cache";
import { tokenize } from "@/lib/text/normalize";
import type { ProductSpec } from "./schema";

/**
 * Below this share of shared identity words the two cards describe different
 * products — but only when the model's hint agrees. Raise it to catch more
 * rewrites, lower it to charge even less often. TUNE HERE.
 */
export const IDENTITY_OVERLAP_MIN = 0.2;

/**
 * A card has to say at least this many meaningful things about itself before the two
 * sides can be compared at all. Below it ("New project / A small device") we do not
 * know what the product is, and not knowing must never cost money.
 */
export const IDENTITY_WORDS_MIN = 3;

/** Identity words have to carry meaning: these say nothing about what a product IS. */
const STOPWORDS = [
  // English glue and words every product card uses anyway.
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "at", "with", "without", "that", "this",
  "it", "its", "is", "are", "be", "when", "while", "so", "then", "my", "your", "our", "you", "we",
  "device", "product", "gadget", "build", "builds", "system", "kit", "project", "thing", "unit", "box",
  "small", "little", "simple", "smart", "automatic", "auto", "helper", "buddy", "assistant", "mini",
  "uses", "use", "using", "makes", "make", "made", "work", "works", "working", "new",
  // Arabic glue and the same filler words.
  "في", "من", "على", "مع", "الى", "عن", "هذا", "هذه", "الذي", "التي", "و", "او", "ان", "انه",
  "جهاز", "منتج", "نظام", "مشروع", "صندوق", "علبه", "صغير", "ذكي", "تلقائي", "مساعد", "يستخدم", "يعمل", "جديد",
];

/**
 * The words that say what the product IS: its name, its one-line description and the
 * understanding's goal. Features, parts, power, size and style are left out on
 * purpose — changing them is refining, not starting something else.
 */
export function identityWords(spec: Pick<ProductSpec, "name" | "oneLine" | "understanding"> | null | undefined): Set<string> {
  if (!spec) return new Set();
  const text = [spec.name, spec.oneLine, spec.understanding?.goal].filter(Boolean).join(" ");
  // Two-letter leftovers ("it", "ال") carry no identity.
  return new Set(tokenize(text, STOPWORDS).filter((w) => w.length > 2));
}

/**
 * Two identity words mean the same thing when one starts the other and the shared
 * start is at least four letters: "water" / "waters" / "watered" / "waterer" are one
 * word, and so are "نبته" / "النبته". Crude on purpose — a stemmer that is too clever
 * would start calling different products the same, and a word we wrongly split apart
 * is what costs a refining visitor money.
 */
const sameWord = (a: string, b: string) =>
  a === b || ((a.startsWith(b) || b.startsWith(a)) && Math.min(a.length, b.length) >= 4);

/**
 * How much the two cards have in common, 0..1: the share of the SHORTER card's identity
 * words that also appear in the other one. Deliberately the forgiving measure — a
 * reworded card ("Keeps the plant watered" for a plant waterer) still scores well above
 * the threshold, so it stays a refinement.
 *
 * A side that says too little about itself (fewer than IDENTITY_WORDS_MIN words) means
 * we know nothing, and not knowing must never cost money: that answers 1 ("unchanged"),
 * which keeps the turn free.
 */
/**
 * The script a card's identity is mostly written in, or null when neither side wins
 * (a card with as many Arabic as Latin words, or words in some other script). The
 * DOMINANT script, not a pure one: an Arabic card that keeps a board name in Latin
 * letters still reads as Arabic.
 *
 * The card follows the PAGE language, so flipping the EN/AR toggle mid-project
 * rebuilds it in the other script — ordinary behaviour on a bilingual site.
 */
export function identityScript(words: Iterable<string>): "arabic" | "latin" | null {
  let arabic = 0;
  let latin = 0;
  for (const w of words) {
    if (/\p{Script=Arabic}/u.test(w)) arabic += 1;
    else if (/\p{Script=Latin}/u.test(w)) latin += 1;
  }
  if (arabic === latin) return null;
  return arabic > latin ? "arabic" : "latin";
}

export function identityOverlap(
  before: Pick<ProductSpec, "name" | "oneLine" | "understanding"> | null | undefined,
  after: Pick<ProductSpec, "name" | "oneLine" | "understanding"> | null | undefined,
): number {
  const a = [...identityWords(before)];
  const b = [...identityWords(after)];
  if (a.length < IDENTITY_WORDS_MIN || b.length < IDENTITY_WORDS_MIN) return 1;
  // The visitor flipped the EN/AR toggle and the card came back in the other script:
  // two cards in different languages share no words whatever the product is, so
  // comparing them would charge someone who was only refining. We cannot tell, so
  // it is free.
  const sa = identityScript(a);
  const sb = identityScript(b);
  if (sa && sb && sa !== sb) return 1;
  const [small, big] = a.length <= b.length ? [a, b] : [b, a];
  const shared = small.filter((w) => big.some((o) => sameWord(w, o))).length;
  return shared / small.length;
}

export type IdentityCheck = {
  /** true = charge this turn as a new idea (and ask for approval first). */
  newIdea: boolean;
  overlap: number;
  /** What the model said about the newest message. */
  hint: boolean;
};

/**
 * Does this turn start a different product? Conservative by construction: no card
 * yet, no new card, no model hint, or any shared identity above the threshold all
 * answer "no" — i.e. free.
 */
export function newIdeaTurn(opts: {
  /** The card before this turn. */
  before: Pick<ProductSpec, "name" | "oneLine" | "understanding"> | null | undefined;
  /** The card this turn produced; null = the card did not change at all. */
  after: Pick<ProductSpec, "name" | "oneLine" | "understanding"> | null | undefined;
  /** The model's own hint on this turn ("the newest message replaces the product"). */
  hint?: boolean;
}): IdentityCheck {
  const hint = opts.hint === true;
  const overlap = identityOverlap(opts.before, opts.after);
  if (!opts.before || !opts.after) return { newIdea: false, overlap, hint };
  return { newIdea: hint && overlap < IDENTITY_OVERLAP_MIN, overlap, hint };
}

/**
 * A stable key for "this project was already charged for this idea". Migration 0106
 * keeps it unique per project, so an approval replayed (a double click, a retry after
 * a timeout) cannot charge twice. Identity words only, so refining the new product
 * afterwards keeps the same key.
 */
export function ideaKey(spec: Pick<ProductSpec, "name" | "oneLine" | "understanding"> | null | undefined): string {
  return stableHash([...identityWords(spec)].sort());
}
