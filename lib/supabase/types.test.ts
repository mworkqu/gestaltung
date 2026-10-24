// Drift guard for the hand-written row types in lib/supabase/types.ts.
//
// There is no generated `Database` type, so a migration that adds a column to a
// core table can silently leave the TS row type behind (49 columns had drifted
// by 0099). This test replays `create table` / `alter table … add column` over
// supabase/migrations/*.sql and fails when a column has no field in the
// matching TS type. Add the field (optional for pre-migration rows) or, for a
// column that is deliberately server-only, list it in SERVER_ONLY below with a
// reason.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const TYPES_SRC = readFileSync(join(process.cwd(), "lib", "supabase", "types.ts"), "utf8");

/** SQL table → exported TS row type in lib/supabase/types.ts. */
const TABLE_TYPES: Record<string, string> = {
  tenants: "Tenant",
  profiles: "Profile",
  inventory_items: "InventoryItem",
  parts: "Part",
  part_orders: "PartOrder",
  inquiries: "Inquiry",
  projects: "Project",
  project_blocks: "ProjectBlock",
  project_items: "ProjectItem",
  client_inventory_items: "ClientInventoryItem",
  project_parts: "ProjectPart",
  project_schematics: "ProjectSchematic",
  project_schematic_revisions: "ProjectSchematicRevision",
};

/** Columns that exist in SQL but are intentionally not part of the TS row type. */
const SERVER_ONLY: Record<string, Record<string, string>> = {};

const CONSTRAINT_STARTS = /^(constraint|primary|unique|foreign|check|like|exclude)\b/i;

function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/** Split on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** The text between the "(" at `open` and its matching ")". */
function balanced(sql: string, open: number): string {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    if (sql[i] === ")" && --depth === 0) return sql.slice(open + 1, i);
  }
  return "";
}

function columnsFromMigrations(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const add = (t: string, c: string) => {
    if (!tables.has(t)) tables.set(t, new Set());
    tables.get(t)!.add(c.replace(/"/g, "").toLowerCase());
  };
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = stripComments(readFileSync(join(MIGRATIONS, f), "utf8"));

    const create = /create table\s+(?:if not exists\s+)?(?:public\.)?"?(\w+)"?\s*\(/gi;
    for (let m = create.exec(sql); m; m = create.exec(sql)) {
      const body = balanced(sql, m.index + m[0].length - 1);
      for (const item of splitTopLevel(body)) {
        const t = item.trim();
        if (!t || CONSTRAINT_STARTS.test(t)) continue;
        add(m[1], /^"?(\w+)"?/.exec(t)![1]);
      }
    }

    const alter = /alter table\s+(?:if exists\s+)?(?:only\s+)?(?:public\.)?"?(\w+)"?\s+([^;]*?)(?:;|$)/gi;
    for (let m = alter.exec(sql); m; m = alter.exec(sql)) {
      if (!/\badd column\b/i.test(m[2])) continue;
      for (const item of splitTopLevel(m[2])) {
        const c = /add column\s+(?:if not exists\s+)?"?(\w+)"?/i.exec(item);
        if (c) add(m[1], c[1]);
      }
    }
  }
  return tables;
}

/** Field names declared at the top level of `export type <name> = { … };`. */
function tsFields(typeName: string): Set<string> {
  const start = TYPES_SRC.indexOf(`export type ${typeName} = {`);
  if (start < 0) throw new Error(`lib/supabase/types.ts has no object type ${typeName}`);
  const end = TYPES_SRC.indexOf("\n};", start);
  const block = TYPES_SRC.slice(start, end);
  const fields = new Set<string>();
  for (const line of block.split("\n")) {
    const m = /^ {2}(\w+)\??:/.exec(line);
    if (m) fields.add(m[1].toLowerCase());
  }
  return fields;
}

describe("migration parser", () => {
  const cols = columnsFromMigrations();
  it("finds create-table and add-column columns", () => {
    expect(cols.get("profiles")?.has("role")).toBe(true); // create table
    expect(cols.get("profiles")?.has("price_cohort")).toBe(true); // alter … add column (0060)
    expect(cols.get("part_orders")?.has("shipping_tier")).toBe(true); // multi-column alter (0029)
  });
  it("does not treat constraints as columns", () => {
    for (const set of cols.values()) {
      for (const c of ["primary", "unique", "foreign", "constraint", "check"]) expect(set.has(c)).toBe(false);
    }
  });
});

describe("lib/supabase/types.ts matches the migrations", () => {
  const cols = columnsFromMigrations();
  for (const [table, typeName] of Object.entries(TABLE_TYPES)) {
    it(`${typeName} has every column of public.${table}`, () => {
      const sql = cols.get(table);
      expect(sql, `no create table for ${table} in supabase/migrations`).toBeDefined();
      const ts = tsFields(typeName);
      const skip = SERVER_ONLY[table] ?? {};
      const missing = [...sql!].filter((c) => !ts.has(c) && !(c in skip));
      expect(missing, `${typeName} is missing columns of public.${table}`).toEqual([]);
    });
  }
});
