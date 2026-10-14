// Export every CAD Champions message string to docs/cad-champions/strings.csv
// Columns: key,en,ar,file,used_in   (UTF-8 with BOM so Excel shows Arabic)
// key = "<message-file>.<dotted.path>", e.g. get-ready.welcome.title
// Usage: node scripts/cc-strings-export.mjs
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const msgDir = (l) => join(root, "messages", "cad-champions", l);
const OUT = join(root, "docs", "cad-champions", "strings.csv");

const flatten = (obj, prefix = "") =>
  Object.entries(obj ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );

function csvCell(s) {
  const t = String(s ?? "");
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

// ---- source scan (best effort): app/ components/ lib/ ----
const exts = new Set([".ts", ".tsx"]);
function walk(dir, out) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (exts.has(name.slice(name.lastIndexOf(".")))) out.push(p);
  }
}
const sources = [];
for (const d of ["app", "components", "lib"]) walk(join(root, d), sources);
const texts = sources
  .filter((p) => /cad-champions/.test(p))
  .map((p) => [relative(root, p).replace(/\\/g, "/"), readFileSync(p, "utf8")]);

const usedCache = new Map();
function usedIn(path) {
  if (usedCache.has(path)) return usedCache.get(path);
  const needles = [`"${path}"`, `'${path}'`, "`" + path + "`"];
  const hits = [];
  for (const [p, t] of texts) {
    if (needles.some((n) => t.includes(n))) {
      hits.push(p);
      if (hits.length === 3) break;
    }
  }
  const v = hits.join(" ; ");
  usedCache.set(path, v);
  return v;
}

const files = readdirSync(msgDir("en")).filter((f) => f.endsWith(".json")).sort();
const rows = [];
for (const f of files) {
  const base = f.replace(/\.json$/, "");
  const en = new Map(flatten(JSON.parse(readFileSync(join(msgDir("en"), f), "utf8"))));
  const arPath = join(msgDir("ar"), f);
  const ar = existsSync(arPath) ? new Map(flatten(JSON.parse(readFileSync(arPath, "utf8")))) : new Map();
  const keys = [...en.keys(), ...[...ar.keys()].filter((k) => !en.has(k))];
  for (const k of keys) {
    const segs = k.split(".");
    const used = usedIn(k) || (segs.length > 1 ? usedIn(segs.slice(-2).join(".")) : "") || usedIn(segs[segs.length - 1]);
    rows.push([`${base}.${k}`, en.get(k) ?? "", ar.get(k) ?? "", `messages/cad-champions/en/${f}`, used]);
  }
}

mkdirSync(join(root, "docs", "cad-champions"), { recursive: true });
const body = [["key", "en", "ar", "file", "used_in"], ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
writeFileSync(OUT, "﻿" + body, "utf8");
console.log(`Exported ${rows.length} strings from ${files.length} files to ${relative(root, OUT)}`);
