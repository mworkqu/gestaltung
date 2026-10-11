// W8: a tiny cache for the Studio's AI answers (idea chat turn, parts pick).
// Pure and isomorphic: the SAME key rule runs in the browser (so going back and
// forward never re-runs an AI call) and on the server (an in-memory LRU per
// instance, so a second device or a reload does not pay for it again).
//
// The key is a hash of the canonical JSON of the inputs: object keys are sorted
// (key order never matters), undefined fields are dropped, arrays keep their order.

/** JSON with sorted object keys; undefined and functions are dropped like JSON.stringify does. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  const o = value as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(o).sort()) {
    if (o[k] === undefined || typeof o[k] === "function") continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(o[k])}`);
  }
  return `{${parts.join(",")}}`;
}

/** cyrb53: a fast 53-bit string hash. Two seeds are joined below (106 bits). */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Stable hash of any JSON-like value (object key order does not matter). */
export function stableHash(value: unknown): string {
  const s = stableStringify(value);
  return `${cyrb53(s, 0).toString(36)}${cyrb53(s, 1).toString(36)}`;
}

/** Least-recently-used map with an optional time to live. */
export class Lru<V> {
  private readonly map = new Map<string, { v: V; at: number }>();
  hits = 0;
  misses = 0;
  constructor(
    private readonly max: number,
    private readonly ttlMs: number = Infinity,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) {
      this.misses++;
      return undefined;
    }
    if (this.now() - e.at > this.ttlMs) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // Most recently used goes last.
    this.map.delete(key);
    this.map.set(key, e);
    this.hits++;
    return e.v;
  }

  set(key: string, v: V): void {
    this.map.delete(key);
    this.map.set(key, { v, at: this.now() });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}

/** Reads through the cache: a hit returns the stored value, a miss runs `make` and stores an acceptable result. */
export async function cached<V>(
  cache: Lru<V> | null | undefined,
  key: string,
  make: () => Promise<V>,
  keep: (v: V) => boolean = () => true,
): Promise<V> {
  if (!cache) return make();
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const v = await make();
  if (keep(v)) cache.set(key, v);
  return v;
}
