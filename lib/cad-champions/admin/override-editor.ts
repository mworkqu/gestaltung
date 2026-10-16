// Pure helpers for the content-override editors (Get Ready, Glossary, Landing;
// Prompt 11). No database here: grouping a message tree for the editor,
// validating override keys / values, and planning the rows to write.
// The server action lives in override-editor-server.ts.

import {
  OVERRIDE_PREFIX,
  flattenMessages,
  isOverrideKey,
  normaliseOverrideValue,
  type OverrideLocale,
} from "../content/overrides";
import { GLOSSARY_IDS } from "../glossary";
import { POLICIES_APPROVED_KEY } from "../policies/approval";
import { isCcFaqId } from "../landing/faq";
import { VIDEO_SLOTS, parseSlotVideo } from "../videos/registry";

export const MAX_ENTRIES_PER_SAVE = 600;

/** The on/off switches an admin may set ("flag:" keys). */
export const CC_FLAG_KEYS = [POLICIES_APPROVED_KEY] as const;

export interface OverrideEntry {
  key: string;
  en: string;
  ar: string;
}

type Tree = Record<string, unknown>;

// ------------------------------------------------------------------ editor model

/** What kind of control an item renders. */
export type OverrideItemKind = "text" | "textarea" | "video" | "flag";

export interface OverrideItem {
  /** Full override key (msg:/video:/glossary:/faq:). */
  key: string;
  /** Short label (dotted path, field name, slot title). */
  label: string;
  kind: OverrideItemKind;
  defaultEn: string;
  defaultAr: string;
  /** Extra line under the label (e.g. the registry default of a video slot). */
  hint?: string;
  /** Saved override per locale ("" = none). */
  en: string;
  ar: string;
}

export interface OverrideGroup {
  id: string;
  title: string;
  subtitle?: string;
  items: OverrideItem[];
}

/** Longer texts get a textarea, short labels a single line. */
export function kindForText(text: string): OverrideItemKind {
  return text.length > 70 || text.includes("\n") ? "textarea" : "text";
}

/**
 * Message-tree items for one file (e.g. "get-ready"), grouped by the first
 * path segment under the file. `enTree` / `arTree` are the raw trees of that
 * file; `overrides` maps key -> value per locale.
 */
export function buildMessageGroups(
  file: string,
  enTree: unknown,
  arTree: unknown,
  overrides: { en: ReadonlyMap<string, string>; ar: ReadonlyMap<string, string> },
  opts: { titleFor?: (top: string) => string } = {},
): OverrideGroup[] {
  const ar = new Map(flattenMessages(arTree));
  const groups = new Map<string, OverrideGroup>();
  for (const [path, defaultEn] of flattenMessages(enTree)) {
    const top = path.split(".")[0];
    const key = `${OVERRIDE_PREFIX.msg}${file}.${path}`;
    const item: OverrideItem = {
      key,
      label: path,
      kind: kindForText(defaultEn),
      defaultEn,
      defaultAr: ar.get(path) ?? "",
      en: overrides.en.get(key) ?? "",
      ar: overrides.ar.get(key) ?? "",
    };
    let g = groups.get(top);
    if (!g) {
      g = { id: top, title: opts.titleFor ? opts.titleFor(top) : top, items: [] };
      groups.set(top, g);
    }
    g.items.push(item);
  }
  return [...groups.values()];
}

/** Items that have a saved override in either language. */
export function countOverridden(group: OverrideGroup): number {
  return group.items.filter((i) => i.en.trim() !== "" || i.ar.trim() !== "").length;
}

/** Case-insensitive search over label, key, defaults and saved values. Empty query = everything. */
export function filterGroups(groups: readonly OverrideGroup[], query: string): OverrideGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  const out: OverrideGroup[] = [];
  for (const g of groups) {
    const groupHit = `${g.id} ${g.title} ${g.subtitle ?? ""}`.toLowerCase().includes(q);
    const items = groupHit
      ? g.items
      : g.items.filter((i) => `${i.label} ${i.key} ${i.defaultEn} ${i.defaultAr} ${i.en} ${i.ar}`.toLowerCase().includes(q));
    if (items.length > 0) out.push({ ...g, items });
  }
  return out;
}

// ------------------------------------------------------------------ dirty tracking

export interface EditorValue {
  en: string;
  ar: string;
}

/** Entries to send: items whose edited value differs from the saved baseline. */
export function dirtyEntries(
  items: readonly Pick<OverrideItem, "key" | "kind">[],
  current: Readonly<Record<string, EditorValue>>,
  base: Readonly<Record<string, EditorValue>>,
): OverrideEntry[] {
  const out: OverrideEntry[] = [];
  const norm = (v: string | undefined) => (v ?? "").replace(/\r\n/g, "\n").trim();
  for (const it of items) {
    const c = current[it.key] ?? { en: "", ar: "" };
    const b = base[it.key] ?? { en: "", ar: "" };
    if (it.kind === "video") {
      // One id for both locales: the English box is the source.
      const v = norm(c.en);
      if (v !== norm(b.en) || v !== norm(b.ar)) out.push({ key: it.key, en: v, ar: v });
    } else if (it.kind === "flag") {
      const on = c.en.trim() === "1" ? "1" : "";
      if (on !== (b.en.trim() === "1" ? "1" : "")) out.push({ key: it.key, en: on, ar: on });
    } else if (norm(c.en) !== norm(b.en) || norm(c.ar) !== norm(b.ar)) {
      out.push({ key: it.key, en: norm(c.en), ar: norm(c.ar) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ validation

/** Placeholder names used by ICU arguments: {name}, {count, plural, ...}. */
export function placeholdersOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g)) out.add(m[1]);
  return [...out].sort();
}

/** Rich-text tags such as <b>…</b> or <link>…</link>. */
export function tagsOf(text: string): string[] {
  return [...text.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\s*>/g)].map((m) => m[0]).sort();
}

function bracesBalanced(text: string): boolean {
  let depth = 0;
  for (const ch of text) {
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

/**
 * A message override must keep the default's placeholders and tags and have
 * balanced braces; otherwise next-intl would throw while rendering the page.
 */
export function isSafeMessageOverride(defaultText: string, value: string): boolean {
  if (!bracesBalanced(value)) return false;
  const a = placeholdersOf(defaultText).join("|");
  const b = placeholdersOf(value).join("|");
  if (a !== b) return false;
  return tagsOf(defaultText).join("|") === tagsOf(value).join("|");
}

/** Walks a message tree to a dotted path; returns the string leaf or null. */
export function leafAt(tree: unknown, dotted: string): string | null {
  let node: unknown = tree;
  for (const p of dotted.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node) || !Object.prototype.hasOwnProperty.call(node, p)) return null;
    node = (node as Tree)[p];
  }
  return typeof node === "string" ? node : null;
}

/** Stored intro-video value: YouTube id, Bunny GUID or file:<self-hosted id> (parseSlotVideo decides). */
export function isValidVideoValue(value: string): boolean {
  return parseSlotVideo(value).provider !== "placeholder";
}

export function isKnownVideoSlot(slotKey: string): boolean {
  return VIDEO_SLOTS.some((v) => v.key === slotKey);
}

/** Intro video slots shown on the Get Ready page. */
export function getReadyVideoSlots() {
  return VIDEO_SLOTS.filter((v) => v.page === "/get-ready");
}

export type KeyIssue = "bad_key" | "unknown_flag" | "out_of_scope" | "unknown_message" | "unknown_video" | "bad_video" | "unknown_glossary" | "unknown_faq" | "unsafe_message";

export interface CheckContext {
  /** CC message tree (the `CC` object) — the English one; en/ar have identical key sets. */
  messages: unknown;
  /** Scope filter: only keys this editor may write. */
  allow?: (key: string) => boolean;
}

/** Validates ONE entry value for a locale; returns the first problem or null. */
export function checkEntry(entry: OverrideEntry, ctx: CheckContext): KeyIssue | null {
  const { key } = entry;
  if (!isOverrideKey(key)) return "bad_key";
  if (ctx.allow && !ctx.allow(key)) return "out_of_scope";
  if (key.startsWith(OVERRIDE_PREFIX.msg)) {
    const dotted = key.slice(OVERRIDE_PREFIX.msg.length);
    const def = leafAt(ctx.messages, dotted);
    if (def === null) return "unknown_message";
    for (const v of [entry.en, entry.ar]) {
      const n = normaliseOverrideValue(v);
      if (n !== null && !isSafeMessageOverride(def, n)) return "unsafe_message";
    }
    return null;
  }
  if (key.startsWith(OVERRIDE_PREFIX.video)) {
    if (!isKnownVideoSlot(key.slice(OVERRIDE_PREFIX.video.length))) return "unknown_video";
    for (const v of [entry.en, entry.ar]) {
      const n = normaliseOverrideValue(v);
      if (n !== null && !isValidVideoValue(n)) return "bad_video";
    }
    return null;
  }
  if (key.startsWith(OVERRIDE_PREFIX.glossary)) {
    const m = /^glossary:(.+)\.(term|definition)$/.exec(key);
    if (!m || !(GLOSSARY_IDS as string[]).includes(m[1])) return "unknown_glossary";
    return null;
  }
  if (key.startsWith(OVERRIDE_PREFIX.faq)) {
    const m = /^faq:(.+)\.hidden$/.exec(key);
    if (!m || !isCcFaqId(m[1])) return "unknown_faq";
    for (const v of [entry.en, entry.ar]) {
      const n = normaliseOverrideValue(v);
      if (n !== null && n !== "1") return "bad_key";
    }
    return null;
  }
  if (key.startsWith(OVERRIDE_PREFIX.flag)) {
    if (!(CC_FLAG_KEYS as readonly string[]).includes(key)) return "unknown_flag";
    for (const v of [entry.en, entry.ar]) {
      const n = normaliseOverrideValue(v);
      if (n !== null && n !== "1") return "bad_key";
    }
    return null;
  }
  return "bad_key";
}

// ------------------------------------------------------------------ write plan

export interface OverrideWrite {
  key: string;
  locale: OverrideLocale;
  /** null = delete the row (back to the default). */
  value: string | null;
}

/** Entries -> one write per key + locale (empty/whitespace = delete). Later duplicates win. */
export function planWrites(entries: readonly OverrideEntry[]): OverrideWrite[] {
  const byKey = new Map<string, OverrideEntry>();
  for (const e of entries) byKey.set(e.key, e);
  const out: OverrideWrite[] = [];
  for (const e of byKey.values()) {
    out.push({ key: e.key, locale: "en", value: normaliseOverrideValue(e.en) });
    out.push({ key: e.key, locale: "ar", value: normaliseOverrideValue(e.ar) });
  }
  return out;
}

/** Drops writes that would change nothing, given the existing rows ("key|locale" -> value). */
export function onlyChanged(writes: readonly OverrideWrite[], existing: ReadonlyMap<string, string>): OverrideWrite[] {
  return writes.filter((w) => (existing.get(`${w.key}|${w.locale}`) ?? null) !== w.value);
}

// ------------------------------------------------------------------ editor scopes

/** Keys the Get Ready editor may write: the get-ready messages and its intro videos. */
export function inGetReadyScope(key: string): boolean {
  if (key.startsWith(`${OVERRIDE_PREFIX.msg}get-ready.`)) return true;
  if (key.startsWith(OVERRIDE_PREFIX.video)) return getReadyVideoSlots().some((s) => s.key === key.slice(OVERRIDE_PREFIX.video.length));
  return false;
}

export function inGlossaryScope(key: string): boolean {
  return key.startsWith(OVERRIDE_PREFIX.glossary);
}

/** Landing editor: FAQ questions / answers and the hide flags. */
export function inLandingScope(key: string): boolean {
  return key.startsWith(`${OVERRIDE_PREFIX.msg}landing.faq.items.`) || key.startsWith(OVERRIDE_PREFIX.faq) || inPoliciesScope(key);
}

/** The intro-video items (one id per slot, used for both languages). */
export function buildVideoItems(
  overrides: { en: ReadonlyMap<string, string>; ar: ReadonlyMap<string, string> },
  describe: (slot: ReturnType<typeof getReadyVideoSlots>[number]) => { label: string; hint: string },
): OverrideItem[] {
  return getReadyVideoSlots().map((slot) => {
    const key = `${OVERRIDE_PREFIX.video}${slot.key}`;
    const v = overrides.en.get(key) ?? overrides.ar.get(key) ?? "";
    const d = describe(slot);
    return { key, label: d.label, hint: d.hint, kind: "video" as const, defaultEn: "", defaultAr: "", en: v, ar: v };
  });
}

/** Policy approval switch (shown on the landing editor page). */
export function inPoliciesScope(key: string): boolean {
  return key === POLICIES_APPROVED_KEY;
}
