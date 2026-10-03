// Splits LEGAL_PAGES_DRAFT.md into content/legal/<slug>.<locale>.md, byte for
// byte. The owner's text is never retyped: each file is the lines between its
// "## <Page> — English|العربية" heading and the next "## " heading, minus the
// "---" separator lines and leading/trailing blank lines.
//
//   node scripts/split-legal-draft.mjs           write the content files
//   node scripts/split-legal-draft.mjs --check   verify the files equal the draft sections
//
// Skipped on purpose (not site content): the DRAFT blockquote at the top and
// the "Page map" section.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DRAFT = "LEGAL_PAGES_DRAFT.md";
const OUT = join("content", "legal");

// heading text -> [slug, locale]
const HEADINGS = {
  "Delivery and Returns — English": ["delivery-returns", "en"],
  "التوصيل والإرجاع — العربية": ["delivery-returns", "ar"],
  "Warranty — English": ["warranty", "en"],
  "الضمان — العربية": ["warranty", "ar"],
  "Terms — English": ["terms", "en"],
  "الشروط والأحكام — العربية": ["terms", "ar"],
  "Privacy — English": ["privacy", "en"],
  "الخصوصية — العربية": ["privacy", "ar"],
};

export function splitDraft(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const sections = new Map();
  let current = null;
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) {
      current = HEADINGS[h[1].trim()] ?? null;
      if (current) sections.set(current.join("."), []);
      continue;
    }
    if (current) sections.get(current.join(".")).push(line);
  }
  const out = {};
  for (const [key, body] of sections) {
    const kept = body.filter((l) => l.trim() !== "---");
    while (kept.length && kept[0].trim() === "") kept.shift();
    while (kept.length && kept[kept.length - 1].trim() === "") kept.pop();
    out[key] = kept.join("\n") + "\n";
  }
  return out;
}

const check = process.argv.includes("--check");
if (!existsSync(DRAFT)) {
  console.error(`${DRAFT} not found`);
  process.exit(1);
}
const parts = splitDraft(readFileSync(DRAFT, "utf8"));
const expected = Object.values(HEADINGS).map(([s, l]) => `${s}.${l}`);
const missing = expected.filter((k) => !(k in parts));
if (missing.length) {
  console.error("Sections missing in the draft: " + missing.join(", "));
  process.exit(1);
}

if (!check) {
  mkdirSync(OUT, { recursive: true });
  for (const key of expected) writeFileSync(join(OUT, `${key}.md`), parts[key], "utf8");
  console.log(`Wrote ${expected.length} files to ${OUT}`);
} else {
  let ok = true;
  for (const key of expected) {
    const file = readFileSync(join(OUT, `${key}.md`), "utf8");
    const same = file === parts[key];
    if (!same) ok = false;
    console.log(`${same ? "OK  " : "DIFF"} ${key}.md (${file.length} chars)`);
  }
  // Whole-set comparison: concatenation of the 8 files vs the 8 draft sections.
  const a = expected.map((k) => readFileSync(join(OUT, `${k}.md`), "utf8")).join("\n");
  const b = expected.map((k) => parts[k]).join("\n");
  console.log(`CONCAT ${a === b ? "OK" : "DIFF"} (${a.length} chars)`);
  process.exit(ok && a === b ? 0 : 1);
}
