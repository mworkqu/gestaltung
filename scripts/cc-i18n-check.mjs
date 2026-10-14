// CAD Champions i18n parity: messages/cad-champions/{en,ar}/*.json must have identical key sets.
// Site messages/en.json vs ar.json are compared too, but only warn (exit 0).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const flatten = (obj, prefix = "") =>
  Object.entries(obj ?? {}).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
const load = (p) => new Set(flatten(JSON.parse(readFileSync(p, "utf8"))));

function diff(enPath, arPath, label, out) {
  const en = load(enPath);
  const ar = load(arPath);
  for (const k of en) if (!ar.has(k)) out.push(`${label}: missing in ar: ${k}`);
  for (const k of ar) if (!en.has(k)) out.push(`${label}: missing in en: ${k}`);
  return en.size;
}

const ccErrors = [];
const warnings = [];
let keys = 0;
let files = 0;

const dir = (l) => join("messages", "cad-champions", l);
const list = (l) => (existsSync(dir(l)) ? readdirSync(dir(l)).filter((f) => f.endsWith(".json")) : []);
const enFiles = new Set(list("en"));
const arFiles = new Set(list("ar"));
for (const f of [...new Set([...enFiles, ...arFiles])].sort()) {
  if (!enFiles.has(f)) ccErrors.push(`cad-champions/${f}: present in ar only`);
  else if (!arFiles.has(f)) ccErrors.push(`cad-champions/${f}: present in en only`);
  else {
    keys += diff(join(dir("en"), f), join(dir("ar"), f), `cad-champions/${f}`, ccErrors);
    files++;
  }
}

if (existsSync("messages/en.json") && existsSync("messages/ar.json")) {
  diff("messages/en.json", "messages/ar.json", "site", warnings);
}

if (warnings.length) {
  console.warn(`Site i18n warning (not CC, ignored): ${warnings.length} mismatched keys`);
}
if (ccErrors.length) {
  console.error("CC i18n: MISMATCH\n  " + ccErrors.join("\n  "));
  process.exit(1);
}
console.log(`CC i18n: OK (${keys} keys across ${files} files)`);
