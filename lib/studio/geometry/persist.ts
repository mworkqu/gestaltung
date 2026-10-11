// The last built cases, kept in this browser (IndexedDB) so the Enclosure step
// shows the visitor's case INSTANTLY on a reload or a later visit instead of
// waiting 1–5 s for the worker to cut it again (W6).
//
//  * stores the packed geometry (typed arrays + the plain plan) by shape key
//    (key.ts) — the same key the in-memory cache uses, so colour / finish never
//    matter;
//  * the namespace carries GEOMETRY_CACHE_VERSION + the deploy's commit, so a new
//    build of the geometry code never shows an old cut (bump the constant when
//    the build changes in a way the commit would not catch, e.g. local dev);
//  * keeps the newest MAX_ENTRIES, drops anything older than MAX_AGE_MS;
//  * every failure (no IndexedDB, private mode, quota, a slow open) is a miss:
//    the caller simply builds as before. Reads give up after READ_TIMEOUT_MS.

import type { PackedEnclosure } from "./protocol";

export const GEOMETRY_CACHE_VERSION = "w6-1";
const DB_NAME = "studio-geometry";
const STORE = "enclosures";
const MAX_ENTRIES = 4;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const READ_TIMEOUT_MS = 400;

const NAMESPACE = `${GEOMETRY_CACHE_VERSION}:${process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "local"}`;

type Entry = { key: string; at: number; ms: number; data: PackedEnclosure };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

const fullKey = (key: string) => `${NAMESPACE}:${key}`;

/** The saved case for this shape key, or null (never throws, never waits long). */
export async function readPersistedEnclosure(key: string): Promise<{ data: PackedEnclosure; ms: number } | null> {
  const read = (async () => {
    const db = await openDb();
    if (!db) return null;
    return new Promise<{ data: PackedEnclosure; ms: number } | null>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(fullKey(key));
        req.onsuccess = () => {
          const e = req.result as Entry | undefined;
          resolve(e && Date.now() - e.at < MAX_AGE_MS && e.data?.base?.position ? { data: e.data, ms: e.ms } : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  })().catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS));
  return Promise.race([read, timeout]);
}

/** Save a freshly built case (later, when the browser is idle) and prune old ones. */
export function persistEnclosure(key: string, data: PackedEnclosure, ms: number): void {
  if (typeof window === "undefined") return;
  const save = async () => {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const entry: Entry = { key: fullKey(key), at: Date.now(), ms, data };
      store.put(entry);
      // Keep only the newest entries of THIS namespace; older namespaces go entirely.
      const all = store.getAll();
      all.onsuccess = () => {
        const rows = (all.result as Entry[]).filter((e) => e.key !== entry.key);
        const ours = rows.filter((e) => e.key.startsWith(`${NAMESPACE}:`)).sort((a, b) => b.at - a.at);
        const drop = [
          ...rows.filter((e) => !e.key.startsWith(`${NAMESPACE}:`) || Date.now() - e.at > MAX_AGE_MS),
          ...ours.slice(MAX_ENTRIES - 1),
        ];
        for (const e of new Set(drop)) store.delete(e.key);
      };
    } catch {
      /* quota / private mode: just not cached */
    }
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (idle) idle(() => void save(), { timeout: 3000 });
  else setTimeout(() => void save(), 500);
}
