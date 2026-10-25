// W8 (server): the in-memory caches for the two slow AI calls. One per
// instance; the routes pass them in, the orchestrators stay pure (tests pass
// their own, or none). Only answers that came from the model are kept: a safe
// default after an invalid answer is retried next time.

import { Lru, stableHash } from "@/lib/studio/cache";
import type { Outcome } from "./types";

const TEN_MINUTES = 10 * 60 * 1000;

/** Outcomes of different calls share the type-erased store; each call site types its own reads. */
export type AiCache = Lru<unknown>;

export const specCache: AiCache = new Lru<unknown>(200, TEN_MINUTES);
export const pickCache: AiCache = new Lru<unknown>(200, TEN_MINUTES);
/** P5-16 product designer answers (spec + parts + archetypes → validated designs). */
export const productDesignCache: AiCache = new Lru<unknown>(100, TEN_MINUTES);

/** Reads through `cache`; only a model answer is stored. A hit never calls `make`. */
export async function outcomeCached<T>(
  cache: AiCache | null | undefined,
  key: string,
  make: () => Promise<Outcome<T>>,
): Promise<Outcome<T>> {
  if (!cache) return make();
  const hit = cache.get(key) as Outcome<T> | undefined;
  // A copy: callers may adjust what they get, the stored answer stays as the model gave it.
  // `cached`: the answer is the model's, but nothing was consumed on THIS turn (telemetry).
  if (hit) return hit.ok ? { ...structuredClone(hit), cached: true } : structuredClone(hit);
  const out = await make();
  if (out.ok && out.source === "model") cache.set(key, structuredClone(out));
  return out;
}

/** Key of one idea-chat turn: the chat words and the card it refines (the project does not matter). */
export function specKey(i: { idea: string; messages: { role: string; text: string }[]; locale: string; current?: unknown }): string {
  return stableHash({
    idea: i.idea,
    locale: i.locale,
    current: i.current ?? null,
    messages: i.messages.map((m) => ({ role: m.role, text: m.text })),
  });
}

/** Key of one parts pick: the spec, the language and the library that was offered. */
export function pickKey(i: { spec: unknown; locale: string; index: readonly { id: string }[] }): string {
  return stableHash({ spec: i.spec, locale: i.locale, library: i.index.map((e) => e.id).sort() });
}
