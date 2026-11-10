// Import docs/cad-champions/strings.csv back into messages/cad-champions/{en,ar}/*.json
// Only changed values are written (key order preserved, 2-space JSON, original line endings kept).
// Unknown keys are refused. Validates en/ar key parity and ICU {placeholder} parity.
// Exit code 1 on any problem (nothing is written then).
// Usage: node scripts/cc-strings-import.mjs [path/to/strings.csv] [--dry-run]
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const csvPath = args.find((a) => !a.startsWith("--")) ?? join("docs", "cad-champions", "strings.csv");
const msgPath = (l, f) => join("messages", "cad-champions", l, `${f}.json`);

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\r") {
      /* skip */
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "") !== "");
}

const flatten = (obj, prefix = "") =>
  Object.entries(obj ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [[`${prefix}${k}`, String(v)]],
  );

// ICU argument names, including those nested in plural/select branches.
function placeholders(s) {
  const names = new Set();
  const re = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/g;
  let m;
  while ((m = re.exec(s))) names.add(m[1]);
  return names;
}
const eqSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

const problems = [];
if (!existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}
const rows = parseCsv(readFileSync(csvPath, "utf8"));
const header = rows.shift() ?? [];
const ix = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
for (const col of ["key", "en", "ar"]) {
  if (!(col in ix)) {
    console.error(`CSV missing column: ${col}`);
    process.exit(1);
  }
}

const files = readdirSync(join("messages", "cad-champions", "en"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const data = { en: {}, ar: {} };
const raw = {};
for (const l of ["en", "ar"]) {
  for (const f of files) {
    const p = msgPath(l, f);
    if (!existsSync(p)) continue;
    raw[p] = readFileSync(p, "utf8");
    data[l][f] = JSON.parse(raw[p]);
  }
}

function getLeaf(obj, segs) {
  let cur = obj;
  for (const s of segs) {
    if (cur == null || typeof cur !== "object" || !(s in cur)) return undefined;
    cur = cur[s];
  }
  return typeof cur === "string" ? cur : undefined;
}
function setLeaf(obj, segs, value) {
  let cur = obj;
  for (const s of segs.slice(0, -1)) cur = cur[s];
  cur[segs[segs.length - 1]] = value;
}

const changed = new Set();
let changes = 0;
for (const [n, r] of rows.entries()) {
  const key = (r[ix.key] ?? "").trim();
  if (!key) continue;
  // longest matching file prefix (file names may contain dashes, never dots)
  const file = files.find((f) => key.startsWith(f + "."));
  if (!file) {
    problems.push(`row ${n + 2}: unknown key (no such message file): ${key}`);
    continue;
  }
  const segs = key.slice(file.length + 1).split(".");
  for (const l of ["en", "ar"]) {
    const cur = getLeaf(data[l][file], segs);
    if (cur === undefined) {
      problems.push(`row ${n + 2}: unknown key for ${l}: ${key}`);
      continue;
    }
    const next = r[ix[l]] ?? "";
    if (next !== cur) {
      if (next === "") {
        problems.push(`row ${n + 2}: ${l} value emptied for ${key} (refused)`);
        continue;
      }
      setLeaf(data[l][file], segs, next);
      changed.add(msgPath(l, file));
      changes++;
      console.log(`${dry ? "[dry] would change" : "changed"} ${l}: ${key}`);
    }
  }
}

// validation: key parity and placeholder parity
for (const f of files) {
  if (!data.ar[f]) {
    problems.push(`${f}: missing ar file`);
    continue;
  }
  const en = new Map(flatten(data.en[f]));
  const ar = new Map(flatten(data.ar[f]));
  for (const k of en.keys()) if (!ar.has(k)) problems.push(`${f}: missing in ar: ${k}`);
  for (const k of ar.keys()) if (!en.has(k)) problems.push(`${f}: missing in en: ${k}`);
  for (const [k, v] of en) {
    const a = ar.get(k);
    if (a !== undefined && !eqSet(placeholders(v), placeholders(a))) {
      problems.push(
        `${f}.${k}: placeholder mismatch en {${[...placeholders(v)].join(",")}} vs ar {${[...placeholders(a)].join(",")}}`,
      );
    }
  }
}

if (problems.length) {
  console.error(`\nImport problems (${problems.length}); nothing written:\n  ` + problems.join("\n  "));
  process.exit(1);
}
if (!dry) {
  for (const p of changed) {
    const parts = p.split(sep);
    const l = parts[2];
    const f = parts[3].replace(/\.json$/, "");
    const eol = raw[p].includes("\r\n") ? "\r\n" : "\n";
    writeFileSync(p, JSON.stringify(data[l][f], null, 2).replace(/\n/g, eol) + eol, "utf8");
  }
}
console.log(`${dry ? "Dry run: " : ""}${changes} value(s) ${dry ? "would change" : "updated"} in ${changed.size} file(s). Parity OK.`);
