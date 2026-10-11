"use client";

// W8 (browser): the Studio keeps the answers of its two slow AI calls (idea chat
// turn, parts pick) for the life of the tab, keyed by a stable hash of what was
// asked. Going back and forward, or returning to an earlier card, never calls the
// model again; a CHANGED spec or chat has a different hash and runs as before
// ("Update my parts" still re-picks). Only successful answers are kept, and two
// identical calls in flight share one request.

import { Lru, stableHash } from "@/lib/studio/cache";
import type { PickReply, Res, SpecReply, StudioApi } from "./api";

type Store = { spec: Lru<Res<SpecReply>>; pick: Lru<Res<PickReply>> };

const MAX = 60;

function copy<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

/** Key of one chat turn (note lines and chips are not words the model sees). */
export function specCacheKey(
  projectId: string,
  b: { idea: string; messages: { role: string; text: string }[]; locale: string; current?: unknown },
): string {
  return stableHash({
    p: projectId,
    idea: b.idea,
    locale: b.locale,
    current: b.current ?? null,
    messages: b.messages.filter((m) => m.text.trim()).map((m) => ({ role: m.role, text: m.text })),
  });
}

export function pickCacheKey(projectId: string, spec: unknown, locale: string): string {
  return stableHash({ p: projectId, spec, locale });
}

/** Wraps an api so `spec` and `pick` read through the caches. Everything else is untouched. */
export function withStudioCache(api: StudioApi, store?: Store): StudioApi {
  const s: Store = store ?? { spec: new Lru(MAX), pick: new Lru(MAX) };
  const inflight = new Map<string, Promise<Res<unknown>>>();

  async function through<T>(lru: Lru<Res<T>>, key: string, make: () => Promise<Res<T>>, adopt: (r: Res<T>) => Res<T> = (r) => r): Promise<Res<T>> {
    const hit = lru.get(key);
    if (hit) return copy(hit);
    const running = inflight.get(key) as Promise<Res<T>> | undefined;
    if (running) return copy(await running);
    const p = make();
    inflight.set(key, p);
    try {
      const r = await p;
      if (r.ok) lru.set(key, copy(adopt(r)));
      return r;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    ...api,
    spec: (b) => through(s.spec, specCacheKey(api.projectId, b), () => api.spec(b)),
    // The route saved the doc on the first run; a repeat has no new server version
    // (docVersion null), so the shell saves the doc itself like for an edit.
    pick: (spec, locale) =>
      through(
        s.pick,
        pickCacheKey(api.projectId, spec, locale),
        () => api.pick(spec, locale),
        (r) => (r.ok ? { ok: true, data: { ...r.data, docVersion: null } } : r),
      ),
  };
}
