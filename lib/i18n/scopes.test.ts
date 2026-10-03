// Guards the per-route message scoping (lib/i18n/scopes.ts): every client
// component reachable from every page and layout must find the namespaces
// (or the single keys) it reads in the provider above it. Static analysis of
// the import graph, no rendering:
//   - a file starting with "use client", and everything it imports, is client;
//   - `const t = useTranslations("Ns")` + `t("key")` / `t.rich("key")` needs
//     "Ns.key"; a non-literal key, or `t` passed elsewhere, needs all of "Ns";
//   - the provider in force is the nearest <MessagesScope scope="..."> above
//     the component: in the same server file or one importing it, else in an
//     ancestor layout, else BASE_MESSAGES from the locale layout.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { BASE_MESSAGES, MESSAGE_SCOPES } from "./scopes";
import { pickMessages } from "./pick-messages";
import en from "../../messages/en.json";

const ROOT = process.cwd();
const APP = path.join(ROOT, "app", "[locale]");
const EXTS = [".tsx", ".ts"];

function resolveImport(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => path.join(base, "index" + e))]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile() && EXTS.includes(path.extname(c))) return c;
  }
  return null;
}

/** The source without leading whitespace and comments (where "use client" must come first). */
function stripLeadingComments(src: string): string {
  let s = src;
  for (;;) {
    s = s.trimStart();
    if (s.startsWith("//")) s = s.slice(s.indexOf("\n") + 1 || s.length);
    else if (s.startsWith("/*")) s = s.slice(s.indexOf("*/") + 2 || s.length);
    else return s;
  }
}

type FileInfo ={ client: boolean; imports: string[]; scope: string | null; needs: Set<string> };
const infoCache = new Map<string, FileInfo>();

function fileInfo(file: string): FileInfo {
  const hit = infoCache.get(file);
  if (hit) return hit;
  const src = fs.readFileSync(file, "utf8");
  const client = /^["']use client["']/.test(stripLeadingComments(src));
  const imports: string[] = [];
  for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
    const r = resolveImport(m[1] ?? m[2], file);
    if (r) imports.push(r);
  }
  const scope = src.match(/<MessagesScope\s+scope="(\w+)"/)?.[1] ?? null;
  const needs = new Set<string>();
  for (const m of src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*useTranslations\(\s*([^)]*)\)/g)) {
    const [, v, arg] = m;
    const lit = arg.trim().match(/^["']([\w.]+)["']$/);
    if (!lit) {
      needs.add(arg.trim() === "" ? "*ROOT*" : `*DYNAMIC*:${arg.trim()}`);
      continue;
    }
    const ns = lit[1];
    const uses = [...src.matchAll(new RegExp(`\\b${v}\\b(\\.(?:rich|markup|raw|has))?(\\s*\\()?`, "g"))];
    let whole = false;
    const keys = new Set<string>();
    for (const u of uses) {
      if (!u[2]) {
        // Bare reference: the declaration itself, or `t` handed to something else.
        const before = src.slice(Math.max(0, u.index! - 12), u.index!);
        if (!/(const|let)\s+$/.test(before)) whole = true;
        continue;
      }
      const after = src.slice(u.index! + u[0].length);
      const key = after.match(/^\s*["']([^"'$]+)["']/);
      if (key) keys.add(key[1]);
      else whole = true;
    }
    if (whole || keys.size === 0) needs.add(ns);
    else for (const k of keys) needs.add(`${ns}.${k}`);
  }
  if (/useMessages\(/.test(src)) needs.add("*ROOT*");
  const info = { client, imports, scope, needs };
  infoCache.set(file, info);
  return info;
}

/** Message entries required by the client components under `entry`, grouped by the scope providing them. */
function requirements(entry: string, startScope: string): Map<string, Set<string>> {
  const byScope = new Map<string, Set<string>>();
  const seen = new Set<string>();
  const stack: [string, boolean, string][] = [[entry, false, startScope]];
  while (stack.length) {
    const [file, inClient, scope] = stack.pop()!;
    const key = `${file}|${inClient}|${scope}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = fileInfo(file);
    const client = inClient || info.client;
    // A server file that renders <MessagesScope> sets the scope for what it renders.
    const here = !client && info.scope ? info.scope : scope;
    if (client) {
      const set = byScope.get(here) ?? new Set<string>();
      info.needs.forEach((n) => set.add(n));
      byScope.set(here, set);
    }
    for (const imp of info.imports) stack.push([imp, client, here]);
  }
  return byScope;
}

function provided(scope: string): readonly string[] | "all" {
  if (scope === "all") return "all";
  if (scope === "BASE") return BASE_MESSAGES;
  const s = (MESSAGE_SCOPES as Record<string, readonly string[]>)[scope];
  if (!s) throw new Error(`unknown scope "${scope}"`);
  return s;
}

function covers(entries: readonly string[], need: string): boolean {
  return entries.some((e) => need === e || need.startsWith(`${e}.`));
}

/** The scope in force at the top of `file`: the nearest ancestor layout's, else BASE. */
function inheritedScope(file: string): string {
  let dir = path.dirname(file);
  const isLayout = path.basename(file) === "layout.tsx";
  if (isLayout) dir = path.dirname(dir);
  while (dir.startsWith(APP) && dir !== APP) {
    const layout = path.join(dir, "layout.tsx");
    if (fs.existsSync(layout)) {
      const s = fileInfo(layout).scope;
      if (s) return s;
    }
    dir = path.dirname(dir);
  }
  return "BASE";
}

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...routeFiles(p));
    else if (/^(page|layout|not-found|error|loading|template)\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("message scopes", () => {
  const files = routeFiles(APP);

  it("finds the route files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files.map((f) => [path.relative(ROOT, f).replace(/\\/g, "/"), f]))(
    "%s: every client namespace is provided",
    (_rel, file) => {
      const missing: string[] = [];
      for (const [scope, needs] of requirements(file, inheritedScope(file))) {
        const entries = provided(scope);
        if (entries === "all") continue;
        for (const n of needs) if (!covers(entries, n)) missing.push(`${n} (scope ${scope})`);
      }
      expect(missing).toEqual([]);
    },
  );

  it("every scope entry exists in messages/en.json", () => {
    const all = [...BASE_MESSAGES, ...Object.values(MESSAGE_SCOPES).flat()];
    const picked = pickMessages(en as Record<string, unknown>, all);
    for (const entry of all) {
      let v: unknown = picked;
      for (const k of entry.split(".")) v = (v as Record<string, unknown> | undefined)?.[k];
      expect(v, entry).toBeDefined();
    }
  });
});
