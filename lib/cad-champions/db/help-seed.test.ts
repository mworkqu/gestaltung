// Applies 0077 + 0079 in PGlite (stubbed Supabase, same as rls.test.ts) and checks the help-article seed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { HELP_SEED_SLUGS } from "../help/seed-slugs";
import { GLOSSARY } from "../glossary";

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${file}`, import.meta.url)), "utf8");

const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Main-site profiles (only what is_super_admin() needs; see 0001).
create table public.profiles (
  id   uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client'
);
create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_super_admin() to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid default auth.uid(),
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant all on storage.objects, storage.buckets to service_role;
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;
`;

interface Row {
  slug: string; category: string; title_en: string; title_ar: string;
  body_en: string; body_ar: string; related_glossary_terms: string[]; sort: number; is_published: boolean;
}
let db: PGlite;
let rows: Row[] = [];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(migration("0077_cc_core.sql"));
  // Twice, to prove the seed is safe to re-run.
  await db.exec(migration("0079_cc_help_articles_seed.sql"));
  await db.exec(migration("0079_cc_help_articles_seed.sql"));
  rows = (await db.query<Row>("select * from public.cc_help_articles order by sort")).rows;
}, 60_000);

describe("help articles seed (0079)", () => {
  it("has 32 published rows and no duplicates after a re-run", () => {
    expect(rows).toHaveLength(32);
    expect(rows.every((r) => r.is_published)).toBe(true);
  });
  it("matches the slug list in order", () => {
    expect(rows.map((r) => r.slug)).toEqual([...HELP_SEED_SLUGS]);
  });
  it("has Arabic letters in every Arabic title and body, and Arabic bodies stay short", () => {
    for (const r of rows) {
      expect(r.title_ar, r.slug).toMatch(/[؀-ۿ]/);
      expect(r.body_ar, r.slug).toMatch(/[؀-ۿ]/);
      expect(r.body_ar.length, r.slug).toBeLessThan(2200);
    }
  });
  it("keeps English bodies under 300 words", () => {
    for (const r of rows) expect(r.body_en.trim().split(/\s+/).length, r.slug).toBeLessThan(300);
  });
  it("uses 0-4 valid glossary ids per article", () => {
    for (const r of rows) {
      expect(r.related_glossary_terms.length, r.slug).toBeGreaterThanOrEqual(0);
      expect(r.related_glossary_terms.length, r.slug).toBeLessThanOrEqual(4);
      for (const id of r.related_glossary_terms) expect(GLOSSARY, `${r.slug}:${id}`).toHaveProperty(id);
    }
  });
});
