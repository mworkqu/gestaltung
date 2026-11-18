// Guards the CAD Champions strings (the CC subtree is excluded from
// lib/i18n/scopes.test.ts because its layout provides every "CC.*" message).
// Static scan of app/[locale]/cad-champions and components/cad-champions:
//   - `const t = useTranslations("CC.x…")` / `await getTranslations("CC.x…")` /
//     `await getTranslations({ locale, namespace: "CC.x…" })`;
//   - each literal `t("key")` / `t.rich("key")` must exist in
//     messages/cad-champions/en/<x>.json AND ar/<x>.json (nested keys ok);
//   - a non-literal key (template string, variable) needs the namespace itself;
//   - every namespace must be under "CC.".
// Plus: en and ar files have identical key sets, and every placeholder page
// key (CcPageKey) has a title and a purpose.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SCAN_DIRS = [path.join(ROOT, "app", "[locale]", "cad-champions"), path.join(ROOT, "components", "cad-champions")];
const MESSAGES = path.join(ROOT, "messages", "cad-champions");
const LOCALES = ["en", "ar"] as const;

type Tree = Record<string, unknown>;

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

function loadMessages(locale: string): Record<string, Tree> {
  const out: Record<string, Tree> = {};
  for (const f of fs.readdirSync(path.join(MESSAGES, locale))) {
    if (f.endsWith(".json")) out[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(MESSAGES, locale, f), "utf8"));
  }
  return out;
}

const messages = Object.fromEntries(LOCALES.map((l) => [l, loadMessages(l)])) as Record<string, Record<string, Tree>>;

/** Value at "CC.file.a.b" in one locale, or undefined. */
function lookup(locale: string, dotted: string): unknown {
  const [cc, file, ...rest] = dotted.split(".");
  if (cc !== "CC" || !file) return undefined;
  let v: unknown = messages[locale][file];
  for (const k of rest) v = v && typeof v === "object" ? (v as Tree)[k] : undefined;
  return v;
}

function leafKeys(tree: unknown, prefix = ""): string[] {
  if (!tree || typeof tree !== "object") return [prefix];
  return Object.entries(tree as Tree).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}

const escape = (s: string) => s.replace(/[$]/g, "\\$");

type Need = { file: string; need: string; kind: "key" | "namespace" };

function needsOf(file: string): Need[] {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const decls: { v: string; ns: string; at: number }[] = [];
  const declRe =
    /(?:const|let)\s+([\w$]+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*(?:["']([\w.]+)["']|\{[^}]*?namespace:\s*["']([\w.]+)["'][^}]*\})\s*\)/g;
  for (const m of src.matchAll(declRe)) decls.push({ v: m[1], ns: m[2] ?? m[3], at: m.index! });

  const out: Need[] = [];
  for (const [i, d] of decls.entries()) {
    out.push({ file: rel, need: d.ns, kind: "namespace" });
    const next = decls.slice(i + 1).find((o) => o.v === d.v);
    const body = src.slice(d.at, next ? next.at : src.length);
    const useRe = new RegExp(`(?<![\\w.$])${escape(d.v)}(?:\\.(rich|markup|raw|has))?\\(\\s*(["'\`])((?:(?!\\2)[^\\\\])*)\\2`, "g");
    for (const u of body.matchAll(useRe)) {
      if (u[1] === "has") continue;
      const key = u[3];
      if (u[2] === "`" && key.includes("${")) continue; // dynamic: namespace check only
      out.push({ file: rel, need: `${d.ns}.${key}`, kind: "key" });
    }
  }
  return out;
}

const files = SCAN_DIRS.flatMap(sourceFiles);
const needs = files.flatMap(needsOf);

describe("CAD Champions messages", () => {
  it("finds the CC source files and translation calls", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(needs.some((n) => n.kind === "key")).toBe(true);
  });

  it("every namespace is under CC.", () => {
    const bad = needs.filter((n) => n.kind === "namespace" && !n.need.startsWith("CC.")).map((n) => `${n.file}: ${n.need}`);
    expect(bad).toEqual([]);
  });

  it.each(LOCALES)("every key used exists in messages/cad-champions/%s", (locale) => {
    const missing = needs
      .filter((n) => n.need.startsWith("CC."))
      .filter((n) => {
        const v = lookup(locale, n.need);
        return n.kind === "key" ? typeof v !== "string" : v === undefined || typeof v !== "object";
      })
      .map((n) => `${n.file}: ${n.need}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  it("en and ar files have identical key sets", () => {
    const fileNames = new Set([...Object.keys(messages.en), ...Object.keys(messages.ar)]);
    for (const f of fileNames) {
      expect(leafKeys(messages.ar[f] ?? {}).sort(), `messages/cad-champions/*/${f}.json`).toEqual(
        leafKeys(messages.en[f] ?? {}).sort(),
      );
    }
  });

  it("every placeholder page key has a title and a purpose", () => {
    const src = fs.readFileSync(path.join(ROOT, "components", "cad-champions", "shell", "placeholder-page.tsx"), "utf8");
    const union = src.match(/export type CcPageKey =([^;]+);/)?.[1] ?? "";
    const keys = [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const l of LOCALES) {
      for (const k of keys) {
        expect(typeof lookup(l, `CC.pages.${k}.title`), `${l} pages.${k}.title`).toBe("string");
        expect(typeof lookup(l, `CC.pages.${k}.purpose`), `${l} pages.${k}.purpose`).toBe("string");
      }
    }
  });
});
