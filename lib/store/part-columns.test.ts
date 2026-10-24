import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PART_PUBLIC_COLUMNS } from "@/lib/store/part-columns";
import { PRIVATE_PART_FIELDS } from "@/lib/store/part-source";

// DB-09 / 0105: anon and authenticated cannot SELECT the cost / sourcing
// columns of parts, so a wildcard read of the table ("permission denied") is a
// broken page, and the embed form is the same read through a join. Every public
// reader names PART_PUBLIC_COLUMNS; an admin read that needs the hidden columns
// goes through readPartsAdmin() (which calls from(t), not from("parts")).
// Source-level on purpose: most of these call sites are pages and server
// actions that no test imports. A new wildcard read fails here.

const ROOT = process.cwd();
const DIRS = ["app", "lib", "components", "scripts", "e2e"];
const SKIP = new Set(["node_modules", ".next", ".vercel", "dist", "build", "out", "coverage"]);

/** This file: it quotes the patterns it bans. */
const SELF = "lib/store/part-columns.test.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (f: string) => relative(ROOT, f).split("\\").join("/");

// `.from("parts")` / `.from('parts')`, and the embed forms `parts(*)`,
// `part:parts(*)`, `...parts(*)` inside another select.
const FROM_PARTS = /\.from\(\s*(["'])parts\1\s*\)/;
const EMBED_STAR = /(?:^|[^\w.])(?:[\w$]+\s*:\s*|\.{3})?parts\s*\(\s*\*/;
// The argument of the chain's FIRST select(): nothing at all, or a wildcard —
// including a wildcard leading a longer list, e.g. select("*, part:parts(name)").
const WILDCARD_ARG = /^\s*(?:\)|(["'`])\s*\*)/;
/** PostgREST ends a chain at the statement; 12 lines covers the formatted ones. */
const CHAIN_LINES = 12;

/** True when the next select() of this chain names no column. Looking only at the
 *  first one keeps the next statement's select out of it. */
function selectsWildcard(chain: string): boolean {
  const at = chain.indexOf(".select(");
  return at !== -1 && WILDCARD_ARG.test(chain.slice(at + ".select(".length));
}

function offenders(): string[] {
  const hits: string[] = [];
  for (const file of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
    const name = rel(file);
    if (name === SELF) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // A comment is prose about the rule, not a query.
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
      if (FROM_PARTS.test(line) && selectsWildcard(lines.slice(i, i + CHAIN_LINES).join("\n"))) {
        hits.push(`${name}:${i + 1} — from("parts") with a wildcard select`);
      }
      if (EMBED_STAR.test(line)) hits.push(`${name}:${i + 1} — parts(*) embed`);
    });
  }
  return hits;
}

describe("no wildcard read of parts (DB-09 / 0105)", () => {
  it("finds the parts call sites (guards against a broken walk)", () => {
    const named = DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => FROM_PARTS.test(readFileSync(f, "utf8")));
    expect(named.length).toBeGreaterThan(20);
  });

  it('no from("parts").select("*") and no parts(*) embed', () => {
    expect(
      offenders(),
      'parts.landed_cost_qar / expected_income_qar / income_pct / below_floor / pricing_mode / pinned_offer_id / preferred_offer_id are not readable by anon or authenticated (migration 0105), so select("*") on parts fails with "permission denied". Name the columns: select(PART_PUBLIC_COLUMNS) from lib/store/part-columns.ts for a public read, or an explicit list of what the call site uses. An admin read that needs the hidden columns must go through readPartsAdmin((t) => db.from(t).select(...)) — the parts_admin view, super_admin rows only.'
    ).toEqual([]);
  });

  it("PART_PUBLIC_COLUMNS names no private column", () => {
    const named = PART_PUBLIC_COLUMNS.split(",").map((c) => c.trim());
    for (const field of PRIVATE_PART_FIELDS) expect(named, field).not.toContain(field);
  });
});
