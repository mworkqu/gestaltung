// "Why this design" in both languages (≤ 160 characters each). The AI's own
// lines when they are usable, else the deterministic template of the archetype
// (messages Studio.product.why_<archetype>, EN + AR). Server + tests only.

import en from "@/messages/en.json";
import ar from "@/messages/ar.json";

import { cut } from "../../ai/types";
import { archetypeWhyKey } from "../archetypes";
import type { Archetype } from "../schema";

export type Why = { en: string; ar: string };
export const WHY_MAX = 160;

type WhyMessages = { Studio: { product: Record<string, string> } };
const EN = (en as unknown as WhyMessages).Studio.product;
const AR = (ar as unknown as WhyMessages).Studio.product;

/** The template line of an archetype (always present: tests check every archetype has both). */
export function whyTemplate(a: Archetype): Why {
  const key = archetypeWhyKey(a);
  return { en: EN[key] ?? "", ar: AR[key] ?? "" };
}

const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{3,}/;

/** AI lines → a usable pair: English must be Latin text, Arabic must be Arabic; else the template. */
export function whyFor(a: Archetype, ai?: { en?: unknown; ar?: unknown } | null): Why {
  const t = whyTemplate(a);
  const e = cut(ai?.en, WHY_MAX);
  const r = cut(ai?.ar, WHY_MAX);
  return {
    en: e && LATIN_WORD.test(e) && !ARABIC.test(e) ? e : t.en,
    ar: r && ARABIC.test(r) ? r : t.ar,
  };
}
