// EN/AR message parity: both files must have exactly the same leaf keys.
import { readFileSync } from "node:fs";

const flatten = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

const load = (locale) => new Set(flatten(JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))));
const en = load("en");
const ar = load("ar");
const missingAr = [...en].filter((k) => !ar.has(k));
const missingEn = [...ar].filter((k) => !en.has(k));

console.log(`PARITY: en ${en.size} keys · ar ${ar.size} keys`);
if (missingAr.length || missingEn.length) {
  if (missingAr.length) console.error("Missing in ar.json:\n  " + missingAr.join("\n  "));
  if (missingEn.length) console.error("Missing in en.json:\n  " + missingEn.join("\n  "));
  process.exit(1);
}
