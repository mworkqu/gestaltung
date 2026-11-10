// Generates lib/supabase/database.types.ts from supabase/migrations/*.sql, with
// no Docker and no network: the migrations are applied, in order, to an
// in-memory PGlite (the same engine the migration tests use) on top of a small
// stub of what Supabase provides (roles, auth.users / auth.uid(), storage), and
// the public schema is read back from the catalog.
//
//   npm run db:types          rewrite lib/supabase/database.types.ts
//   npm run db:types:check    fail when the committed file is stale (CI)
//
// Types follow the shape `supabase gen types typescript` writes (Tables with
// Row / Insert / Update / Relationships, Views, Functions, Enums), so the
// supabase-js generics work unchanged. Never touches a real database.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";

const ROOT = new URL("../", import.meta.url);
const OUT = new URL("lib/supabase/database.types.ts", ROOT);
const MIGRATIONS = new URL("supabase/migrations/", ROOT);

// What every migration assumes Supabase already has.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, phone text, email_confirmed_at timestamptz,
  is_anonymous boolean default false, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}',
  created_at timestamptz default now(), last_sign_in_at timestamptz, encrypted_password text
);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
`;

const NUMBER = new Set(["int2", "int4", "int8", "float4", "float8", "numeric", "oid", "money"]);
const JSON_T = new Set(["json", "jsonb"]);
const STRING = new Set([
  "text", "varchar", "bpchar", "char", "citext", "name", "uuid", "date", "timestamp", "timestamptz", "time", "timetz",
  "interval", "bytea", "inet", "cidr", "macaddr", "xml", "tsvector",
]);

async function introspect() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    try {
      await db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} does not apply to PGlite: ${e.message}`);
    }
  }
  const q = async (sql) => (await db.query(sql)).rows;

  const types = await q(`
    select t.oid::int as oid, t.typname, t.typtype, t.typelem::int as elem, t.typcategory, t.typbasetype::int as base,
           t.typrelid::int as relid, n.nspname
    from pg_type t join pg_namespace n on n.oid = t.typnamespace`);
  const byOid = new Map(types.map((t) => [t.oid, t]));
  const enums = await q(`
    select t.typname, array_agg(e.enumlabel order by e.enumsortorder) labels
    from pg_type t join pg_enum e on e.enumtypid = t.oid join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' group by t.typname`);
  const rels = await q(`
    select c.oid::int as oid, c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m')`);
  const cols = await q(`
    select a.attrelid::int as relid, a.attname, a.atttypid::int as typid, a.attnotnull, a.atthasdef, a.attgenerated, a.attidentity, a.attnum
    from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p','v','m') and a.attnum > 0 and not a.attisdropped
    order by a.attrelid, a.attnum`);
  const fks = await q(`
    select con.conname, con.conrelid::int as relid, con.confrelid::int as frelid,
           (select array_agg(a.attname order by k.ord) from unnest(con.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum) as cols,
           (select array_agg(a.attname order by k.ord) from unnest(con.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.attnum) as fcols,
           exists (select 1 from pg_constraint u where u.conrelid = con.conrelid and u.contype in ('p','u') and u.conkey::int2[] <@ con.conkey::int2[] and u.conkey::int2[] @> con.conkey::int2[]) as one_to_one
    from pg_constraint con join pg_namespace n on n.oid = con.connamespace
    where con.contype = 'f' and n.nspname = 'public'`);
  const procs = await q(`
    select p.proname, p.proretset, p.prorettype::int as rettype, p.pronargdefaults,
           coalesce(p.proallargtypes::int[], p.proargtypes::int[]) as argtypes, p.proargmodes, p.proargnames, p.pronargs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by p.proname, p.oid`);
  return { byOid, enums, rels, cols, fks, procs };
}

const wrap = (s) => (/[|&]/.test(s) ? `(${s})` : s);
const key = (n) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));

// What a write may send into a json/jsonb column: any serialisable value (interfaces and
// Record<string, unknown> included), not only the strict Json union that reads return.
const writeTs = (ts) => (ts === "Json" ? "JsonInput" : ts);

function tsOf(oid, ctx) {
  const t = ctx.byOid.get(oid);
  if (!t) return "unknown";
  if (t.typtype === "d") return tsOf(t.base, ctx);
  if (t.typcategory === "A" && t.elem) return `${wrap(tsOf(t.elem, ctx))}[]`;
  if (t.typtype === "e") return `Database["public"]["Enums"]["${t.typname}"]`;
  if (t.typtype === "c" && t.nspname === "public") {
    const rel = ctx.relByOid.get(t.relid);
    if (rel) return `Database["public"]["${rel.relkind === "v" || rel.relkind === "m" ? "Views" : "Tables"}"]["${rel.relname}"]["Row"]`;
  }
  if (t.typname === "bool") return "boolean";
  if (NUMBER.has(t.typname)) return "number";
  if (JSON_T.has(t.typname)) return "Json";
  if (STRING.has(t.typname)) return "string";
  if (t.typname === "void") return "undefined";
  return "unknown";
}

function render(info) {
  const ctx = { byOid: info.byOid, relByOid: new Map(info.rels.map((r) => [r.oid, r])) };
  const colsOf = (relid) => info.cols.filter((c) => c.relid === relid);
  const out = [];
  const w = (s = "") => out.push(s);

  w("// GENERATED by scripts/db-types.mjs from supabase/migrations/*.sql. Do not edit.");
  w("// Regenerate: npm run db:types   (CI fails when this file is stale: npm run db:types:check)");
  w();
  w("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  w("// Write side of json/jsonb columns and rpc arguments (see scripts/db-types.mjs).");
  w("export type JsonInput = Json | object;");
  w();
  w("export type Database = {");
  w("  public: {");

  const tables = info.rels.filter((r) => r.relkind === "r" || r.relkind === "p").sort((a, b) => a.relname.localeCompare(b.relname));
  w("    Tables: {");
  for (const t of tables) {
    const cs = colsOf(t.oid);
    w(`      ${key(t.relname)}: {`);
    w("        Row: {");
    for (const c of cs) w(`          ${key(c.attname)}: ${tsOf(c.typid, ctx)}${c.attnotnull ? "" : " | null"};`);
    w("        };");
    w("        Insert: {");
    for (const c of cs) {
      if (c.attgenerated === "s" || c.attidentity === "a") continue;
      const optional = !c.attnotnull || c.atthasdef || c.attidentity === "d";
      w(`          ${key(c.attname)}${optional ? "?" : ""}: ${writeTs(tsOf(c.typid, ctx))}${c.attnotnull ? "" : " | null"};`);
    }
    w("        };");
    w("        Update: {");
    for (const c of cs) {
      if (c.attgenerated === "s" || c.attidentity === "a") continue;
      w(`          ${key(c.attname)}?: ${writeTs(tsOf(c.typid, ctx))}${c.attnotnull ? "" : " | null"};`);
    }
    w("        };");
    const mine = info.fks.filter((f) => f.relid === t.oid).sort((a, b) => a.conname.localeCompare(b.conname));
    if (mine.length === 0) w("        Relationships: [];");
    else {
      w("        Relationships: [");
      for (const f of mine) {
        const ref = ctx.relByOid.get(f.frelid);
        w("          {");
        w(`            foreignKeyName: ${JSON.stringify(f.conname)};`);
        w(`            columns: ${JSON.stringify(f.cols)};`);
        w(`            isOneToOne: ${f.one_to_one};`);
        w(`            referencedRelation: ${JSON.stringify(ref?.relname ?? "unknown")};`);
        w(`            referencedColumns: ${JSON.stringify(f.fcols)};`);
        w("          },");
      }
      w("        ];");
    }
    w("      };");
  }
  w("    };");

  const views = info.rels.filter((r) => r.relkind === "v" || r.relkind === "m").sort((a, b) => a.relname.localeCompare(b.relname));
  if (views.length === 0) w("    Views: { [_ in never]: never };");
  else {
    w("    Views: {");
    for (const v of views) {
      w(`      ${key(v.relname)}: {`);
      w("        Row: {");
      for (const c of colsOf(v.oid)) w(`          ${key(c.attname)}: ${tsOf(c.typid, ctx)} | null;`);
      w("        };");
      w("        Relationships: [];");
      w("      };");
    }
    w("    };");
  }

  // Functions (trigger functions are not callable through rpc: left out).
  const groups = new Map();
  for (const p of info.procs) {
    const ret = ctx.byOid.get(p.rettype);
    if (ret?.typname === "trigger" || ret?.typname === "event_trigger") continue;
    if (!groups.has(p.proname)) groups.set(p.proname, []);
    groups.get(p.proname).push(p);
  }
  w("    Functions: {");
  for (const name of [...groups.keys()].sort()) {
    const sigs = groups.get(name).map((p) => {
      const modes = p.proargmodes ?? null; // null = all IN
      const names = p.proargnames ?? [];
      const ins = [];
      const outs = [];
      p.argtypes.forEach((typ, i) => {
        const mode = modes ? modes[i] : "i";
        const nm = names[i] || `arg${i + 1}`;
        if (mode === "i" || mode === "b" || mode === "v") ins.push({ nm, typ });
        if (mode === "o" || mode === "b" || mode === "t") outs.push({ nm, typ });
      });
      const firstDefault = ins.length - p.pronargdefaults;
      const args = ins.length
        ? `{ ${ins.map((a, i) => `${key(a.nm)}${i >= firstDefault ? "?" : ""}: ${writeTs(tsOf(a.typ, ctx))} | null`).join("; ")} }`
        : "Record<PropertyKey, never>";
      let ret;
      if (outs.length) {
        const row = `{ ${outs.map((o) => `${key(o.nm)}: ${tsOf(o.typ, ctx)}`).join("; ")} }`;
        ret = p.proretset ? `${row}[]` : row;
      } else {
        const base = tsOf(p.rettype, ctx);
        ret = p.proretset ? `${wrap(base)}[]` : base;
      }
      return `{ Args: ${args}; Returns: ${ret} }`;
    });
    const unique = [...new Set(sigs)];
    w(`      ${key(name)}: ${unique.length === 1 ? unique[0] : unique.map((s) => `\n        | ${s}`).join("")};`);
  }
  w("    };");

  w("    Enums: {");
  for (const e of [...info.enums].sort((a, b) => a.typname.localeCompare(b.typname))) {
    w(`      ${key(e.typname)}: ${e.labels.map((l) => JSON.stringify(l)).join(" | ")};`);
  }
  if (info.enums.length === 0) w("      [_ in never]: never;");
  w("    };");
  w("    CompositeTypes: { [_ in never]: never };");
  w("  };");
  w("};");
  return out.join("\n") + "\n";
}

const normalise = (s) => s.replace(/\r\n/g, "\n");

async function main() {
  const text = render(await introspect());
  if (process.argv.includes("--check")) {
    let current = "";
    try {
      current = readFileSync(OUT, "utf8");
    } catch {
      /* missing */
    }
    if (normalise(current) !== text) {
      console.error("lib/supabase/database.types.ts is stale: run `npm run db:types` and commit the result.");
      process.exit(1);
    }
    console.log("database.types.ts is up to date.");
    return;
  }
  writeFileSync(OUT, text);
  console.log(`wrote lib/supabase/database.types.ts (${text.split("\n").length} lines)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
