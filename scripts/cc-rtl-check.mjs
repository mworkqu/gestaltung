// Fails on physical Tailwind utilities (ml-, pr-, left-, text-right, ...) in CAD Champions sources.
// Use logical ones: ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s/e/border-s/e.
// Explicit "ltr:" / "rtl:" prefixed classes are allowed (intentional).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOTS = ["app/[locale]/cad-champions", "components/cad-champions", "lib/cad-champions"];
const EXT = /\.(ts|tsx)$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".git"]);

const PHYSICAL =
  /(?<![\w-])-?(ml|mr|pl|pr|left|right|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|border-l|border-r|text-left|text-right|scroll-ml|scroll-mr|scroll-pl|scroll-pr)-[\w.[\]/%-]+|(?<![\w-])(text-left|text-right|border-l|border-r|rounded-l|rounded-r)(?![\w-])/g;
// A line is "class-like" if it mentions className/cn(/cva(/clsx( or holds a quoted space-separated utility list.
const CLASS_CONTEXT = /className|\bcn\(|\bcva\(|\bclsx\(|twMerge\(|["'`][^"'`]*\b[a-z]+-[\w[\]./%-]+\s+[\w:[\]./%-]+[^"'`]*["'`]/;

export function scanLine(line) {
  if (!CLASS_CONTEXT.test(line)) return [];
  const hits = [];
  for (const m of line.matchAll(PHYSICAL)) {
    const start = m.index ?? 0;
    // Walk back over the variant prefix (e.g. "md:hover:").
    let b = start;
    while (b > 0 && /[\w:[\]./!-]/.test(line[b - 1])) b--;
    const prefix = line.slice(b, start);
    if (/(^|:)(ltr|rtl):/.test(prefix)) continue; // intentional
    if (prefix && !prefix.endsWith(":")) continue; // part of a longer word
    hits.push(prefix + m[0]);
  }
  return hits;
}

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.test(name)) yield p;
  }
}

export function scanFile(path) {
  const out = [];
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      for (const hit of scanLine(line)) out.push(`${path}:${i + 1}  ${hit}`);
    });
  return out;
}

function main() {
  const problems = [];
  for (const root of ROOTS) for (const f of walk(root)) problems.push(...scanFile(f));
  if (problems.length) {
    console.error("CC RTL check: physical direction classes found (use logical ones):\n  " + problems.join("\n  "));
    process.exit(1);
  }
  console.log("CC RTL check: OK");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
