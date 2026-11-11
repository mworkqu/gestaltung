// Applies 0077 + 0081 in PGlite (stubbed Supabase, same as rls.test.ts) and
// checks the results columns and the public share read cc_shared_result().
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

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

const USER = "11111111-1111-4111-8111-111111111111";
const TEST = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(migration("0077_cc_core.sql"));
  // Twice, to prove it is safe to re-run.
  await db.exec(migration("0081_cc_results.sql"));
  await db.exec(migration("0081_cc_results.sql"));
  await db.exec(`
    insert into auth.users (id, email) values ('${USER}', 'sara@example.com');
    insert into public.cc_profiles (id, email, full_name, full_name_ar) values ('${USER}', 'sara@example.com', 'Sara Al Ali', 'سارة العلي');
    insert into public.cc_tests (id, slug, title_en, title_ar, type) values ('${TEST}', 't-0081', 'T', 'ت', 'diagnostic');
    insert into public.cc_attempts (id, user_id, test_id, status, percent, band, share_enabled, share_token)
      values ('${ATTEMPT}', '${USER}', '${TEST}', 'graded', 55, 'developing', true, '${TOKEN}');
    insert into public.cc_skill_scores (attempt_id, skill_area_id, user_id, percent, level, assessed)
      values ('${ATTEMPT}', 3, '${USER}', 80, 5, true), ('${ATTEMPT}', 1, '${USER}', null, null, false);
  `);
}, 60_000);

async function shared(token: string, role = "anon") {
  await db.exec(`set role ${role}`);
  try {
    const r = await db.query<{ v: Record<string, unknown> | null }>("select public.cc_shared_result($1) as v", [token]);
    return r.rows[0]?.v ?? null;
  } finally {
    await db.exec("reset role");
  }
}

describe("0081 results migration", () => {
  it("adds the email + provisional columns", async () => {
    const r = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'cc_attempts' and column_name in ('results_email_sent_at','final_email_sent_at','provisional_percent') order by 1"
    );
    expect(r.rows.map((x) => x.column_name)).toEqual(["final_email_sent_at", "provisional_percent", "results_email_sent_at"]);
  });

  it("anon reads only first name, band and the skill map of a shared attempt", async () => {
    const v = await shared(TOKEN);
    expect(v).not.toBeNull();
    expect(Object.keys(v!).sort()).toEqual(["areas", "band", "first_name", "first_name_ar"]);
    expect(v!.first_name).toBe("Sara");
    expect(v!.band).toBe("developing");
    expect((v!.areas as unknown[]).length).toBe(2);
  });

  it("returns nothing for a wrong token or when sharing is off", async () => {
    expect(await shared("x".repeat(32))).toBeNull();
    await db.exec(`update public.cc_attempts set share_enabled = false where id = '${ATTEMPT}'`);
    expect(await shared(TOKEN)).toBeNull();
    await db.exec(`update public.cc_attempts set share_enabled = true where id = '${ATTEMPT}'`);
  });

  it("returns nothing while the attempt is still grading", async () => {
    await db.exec(`update public.cc_attempts set status = 'grading' where id = '${ATTEMPT}'`);
    expect(await shared(TOKEN, "authenticated")).toBeNull();
    await db.exec(`update public.cc_attempts set status = 'graded' where id = '${ATTEMPT}'`);
  });
});
