// Admin-edited copy that wins over the message files (cc_content_overrides,
// migration 0085). Pure helpers; the database read lives in
// overrides-server.ts. The message-file text is ALWAYS the fallback, so
// nothing changes before 0085 runs or when no override is saved.
//
// Key scheme (one row per key + locale):
//   msg:<file>.<path>              a CC message, e.g. msg:get-ready.welcome.autoNote
//                                  (= the message CC.get-ready.welcome.autoNote)
//   video:<slot key>               an intro video id from the registry
//                                  ("youtube:<11 chars>" or a Bunny GUID)
//   glossary:<id>.term|definition  a glossary entry
//   faq:<id>.hidden                "1" hides a landing FAQ item (locale "en" row)
//   flag:<name>                    an on/off switch, "1" = on (e.g. flag:policies.approved)

export type OverrideLocale = "en" | "ar";

export interface OverrideRow {
  key: string;
  locale: string;
  value: string;
}

/** key -> value for ONE locale. */
export type OverrideMap = ReadonlyMap<string, string>;

export const OVERRIDE_PREFIX = {
  msg: "msg:",
  video: "video:",
  glossary: "glossary:",
  faq: "faq:",
  flag: "flag:",
} as const;

const KEY_RE = /^(msg|video|glossary|faq|flag):[A-Za-z0-9_.-]{1,190}$/;

export function isOverrideKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

export const msgKey = (dotted: string) => `${OVERRIDE_PREFIX.msg}${dotted}`;
export const videoKey = (slot: string) => `${OVERRIDE_PREFIX.video}${slot}`;
export const glossaryKey = (id: string, field: "term" | "definition") => `${OVERRIDE_PREFIX.glossary}${id}.${field}`;
export const flagKey = (name: string) => `${OVERRIDE_PREFIX.flag}${name}`;
export const faqHiddenKey = (id: string) => `${OVERRIDE_PREFIX.faq}${id}.hidden`;

/** Rows of one locale -> map (empty values are ignored: empty = "use the default"). */
export function toOverrideMap(rows: readonly OverrideRow[] | null | undefined, locale: OverrideLocale): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r && r.locale === locale && isOverrideKey(r.key) && typeof r.value === "string" && r.value.trim() !== "") out.set(r.key, r.value);
  }
  return out;
}

/** The override for `key`, else the fallback. */
export function getOverride(map: OverrideMap | null | undefined, key: string, fallback: string): string {
  const v = map?.get(key);
  return v != null && v.trim() !== "" ? v : fallback;
}

type Tree = Record<string, unknown>;

/**
 * Returns a copy of the CC message tree (`{ "get-ready": {...}, landing: {...} }`)
 * with every msg: override applied. Only existing STRING leaves are replaced
 * (an override can never add keys or replace a branch), so the en/ar key sets
 * stay identical.
 */
export function applyMessageOverrides<T extends Tree>(cc: T, map: OverrideMap | null | undefined): T {
  if (!map || map.size === 0 || !cc || typeof cc !== "object") return cc;
  let out: Tree = cc;
  let copied = false;
  for (const [key, value] of map) {
    if (!key.startsWith(OVERRIDE_PREFIX.msg)) continue;
    const parts = key.slice(OVERRIDE_PREFIX.msg.length).split(".");
    if (parts.length < 2 || parts.some((p) => p === "" || p === "__proto__" || p === "constructor" || p === "prototype")) continue;
    // Check the leaf exists and is a string before copying anything.
    let probe: unknown = out;
    for (const p of parts) probe = probe && typeof probe === "object" && Object.prototype.hasOwnProperty.call(probe, p) ? (probe as Tree)[p] : undefined;
    if (typeof probe !== "string") continue;
    if (!copied) {
      out = { ...out };
      copied = true;
    }
    // Copy-on-write along the path.
    let node: Tree = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const child = node[parts[i]] as Tree;
      const clone = { ...child };
      node[parts[i]] = clone;
      node = clone;
    }
    node[parts[parts.length - 1]] = value;
  }
  return out as T;
}

/** Every string leaf of a message tree as [dotted path, text] (for the admin editors). */
export function flattenMessages(tree: unknown, prefix = ""): [string, string][] {
  if (typeof tree === "string") return prefix ? [[prefix, tree]] : [];
  if (!tree || typeof tree !== "object" || Array.isArray(tree)) return [];
  return Object.entries(tree as Tree).flatMap(([k, v]) => flattenMessages(v, prefix ? `${prefix}.${k}` : k));
}

/** Video overrides and glossary overrides of one locale (sent to the client provider). */
export interface ClientOverrides {
  /** slot key -> stored video value */
  videos: Record<string, string>;
  /** glossary id -> { term?, definition? } */
  glossary: Record<string, { term?: string; definition?: string }>;
}

export function clientOverrides(map: OverrideMap | null | undefined): ClientOverrides {
  const out: ClientOverrides = { videos: {}, glossary: {} };
  if (!map) return out;
  for (const [key, value] of map) {
    if (key.startsWith(OVERRIDE_PREFIX.video)) {
      out.videos[key.slice(OVERRIDE_PREFIX.video.length)] = value;
    } else if (key.startsWith(OVERRIDE_PREFIX.glossary)) {
      const rest = key.slice(OVERRIDE_PREFIX.glossary.length);
      const dot = rest.lastIndexOf(".");
      if (dot <= 0) continue;
      const id = rest.slice(0, dot);
      const field = rest.slice(dot + 1);
      if (field !== "term" && field !== "definition") continue;
      out.glossary[id] = { ...out.glossary[id], [field]: value };
    }
  }
  return out;
}

/** Value to save: trimmed; empty = delete the override (back to the default). */
export function normaliseOverrideValue(raw: unknown, max = 20000): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (v === "") return null;
  return v.slice(0, max);
}
