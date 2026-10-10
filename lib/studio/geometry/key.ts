// Cache keys for Studio geometry (no three.js: safe in any bundle).
// The enclosure key covers everything that changes the SHAPE: the spec without
// colour / finish / accent (those are materials only), the layout result, and
// the parts (id + data). "See inside" is not in the spec at all. So a colour,
// finish or x-ray change never rebuilds geometry.

import type { LayoutResult } from "../layout";
import type { EnclosureSpec, Environment, LibraryPart, MechPart } from "../schema";

/** JSON with sorted object keys (the same value always gives the same text). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      return Object.keys(o)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          if (o[k] !== undefined) acc[k] = o[k];
          return acc;
        }, {});
    }
    return v;
  });
}

/** cyrb53: a fast 53-bit string hash (not cryptographic), as base-36 text. */
export function hashText(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The enclosure spec fields that only change materials (never geometry). */
export function shapeOf(spec: EnclosureSpec): Omit<EnclosureSpec, "colour" | "finish" | "accentColour"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { colour, finish, accentColour, ...shape } = spec;
  return shape;
}

export function enclosureKey(spec: EnclosureSpec, layout: LayoutResult, parts: Map<string, LibraryPart>): string {
  const partList = [...parts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `enc:${hashText(stableJson({ shape: shapeOf(spec), layout, parts: partList }))}`;
}

export function mechKey(encKey: string, mech: readonly MechPart[], environment?: Environment): string {
  return `mech:${hashText(stableJson({ encKey, mech, environment: environment ?? null }))}`;
}
