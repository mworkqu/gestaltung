// Test helper for the PGlite migration tests (audit 2026-10 migrations 0100+).
// Mirrors the parts of Supabase every migration relies on: the anon /
// authenticated / service_role roles, auth.uid() / auth.role() from the
// request.jwt.claim.* settings PostgREST sets, and Supabase's DEFAULT
// PRIVILEGES (new public tables / functions are granted to all three roles —
// so a migration has to revoke explicitly). Never touches Supabase.
// Same approach as lib/schools/db/schools-migration.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

export const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${file}`, import.meta.url)), "utf8");

export const SUPABASE_BASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;

-- Supabase's defaults: everything new in public is reachable by all three roles.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean default false
);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

create table public.profiles (
  id   uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client'
);

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false);
$$;
`;

export type Who = string | null | "service";

export function pgliteDb() {
  const db = new PGlite();

  async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await db.query<T>(sql, params)).rows;
  }

  /** Run `fn` as anon (null), an authenticated user (uuid) or service_role, like PostgREST does. */
  async function as<T>(who: Who, fn: () => Promise<T>): Promise<T> {
    await db.exec("reset role");
    const sub = who && who !== "service" ? who : "";
    const role = who === "service" ? "service_role" : who ? "authenticated" : "anon";
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)", [sub, role]);
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)");
    }
  }

  /** The error message of a failing statement, or null when it succeeded. */
  async function fails(sql: string, params: unknown[] = []): Promise<string | null> {
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  /** Apply a migration file twice (it must be safe to re-run). */
  async function applyTwice(file: string) {
    for (let i = 0; i < 2; i++) await db.exec(migration(file));
  }

  return { db, rows, as, fails, applyTwice };
}

/**
 * One `create or replace function public.<name>(…) … $$;` statement, copied
 * from a migration file — so a test can stub the ORIGINAL body a later
 * migration replaces (and show the hole before the fix).
 */
export function migrationFunction(file: string, name: string): string {
  const sql = migration(file);
  const start = sql.indexOf(`create or replace function public.${name}(`);
  if (start < 0) throw new Error(`${name} not found in ${file}`);
  const close = sql.indexOf("$$", sql.indexOf("as $$", start) + 5);
  return sql.slice(start, sql.indexOf(";", close) + 1);
}
