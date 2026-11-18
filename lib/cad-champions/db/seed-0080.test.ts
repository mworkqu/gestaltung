// Seed migration 0080 (diagnostic-v1, diagnostic-timeout-check, practice-cube):
// applies 0077 + 0078 + 0080 (twice, to prove it re-runs) inside PGlite with
// the same minimal Supabase stub as rls.test.ts, then checks the rows and
// what a student can see. Never touches Supabase.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const STUDENT = "00000000-0000-4000-8000-0000000000a1";
let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(migration("0077_cc_core.sql"));
  await db.exec(migration("0078_cc_storage.sql"));
  for (let i = 0; i < 2; i++) await db.exec(migration("0080_cc_diagnostic_seed.sql"));
  await db.exec(`insert into auth.users (id, email) values ('${STUDENT}', 's@example.com');
                 insert into public.cc_profiles (id, email, full_name) values ('${STUDENT}', 's@example.com', 'Student');`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0080 seed", () => {
  it("creates the three tests once", async () => {
    const tests = await rows<{ slug: string; time_limit_minutes: number | null; retake_cooldown_days: number; admin_only: boolean; is_published: boolean; type: string }>(
      "select slug, time_limit_minutes, retake_cooldown_days, admin_only, is_published, type from public.cc_tests order by slug"
    );
    expect(tests).toEqual([
      { slug: "diagnostic-timeout-check", time_limit_minutes: 3, retake_cooldown_days: 0, admin_only: true, is_published: true, type: "diagnostic" },
      { slug: "diagnostic-v1", time_limit_minutes: 90, retake_cooldown_days: 14, admin_only: false, is_published: true, type: "diagnostic" },
      { slug: "practice-cube", time_limit_minutes: null, retake_cooldown_days: 0, admin_only: false, is_published: true, type: "practice" },
    ]);
  });

  it("seeds the four diagnostic tasks as planned", async () => {
    const tasks = await rows<{ position: number; skill_area_id: number; competition_module: string; expected_upload: string; grading_mode: string; density_kg_m3: string | null }>(
      `select tt.position, tt.skill_area_id, tt.competition_module, tt.expected_upload, tt.grading_mode, tt.density_kg_m3
         from public.cc_test_tasks tt join public.cc_tests t on t.id = tt.test_id
        where t.slug = 'diagnostic-v1' order by tt.position`
    );
    expect(tasks.map((x) => [x.position, x.skill_area_id, x.competition_module, x.expected_upload, x.grading_mode])).toEqual([
      [1, 3, "M3", "step", "auto_step"],
      [2, 3, "M3", "step", "auto_step"],
      [3, 3, "M3", "step", "auto_step"],
      [4, 6, "M3", "pdf", "ai_drawing"],
    ]);
    expect(tasks.slice(0, 3).every((x) => Number(x.density_kg_m3) === 7850)).toBe(true);
  });

  it("gives every task aspects whose points add up to the task points", async () => {
    const sums = await rows<{ id: string; max_points: string; aspects: string; n: number }>(
      `select tt.id, tt.max_points, coalesce(sum(a.max_points), 0) as aspects, count(a.id)::int as n
         from public.cc_test_tasks tt left join public.cc_task_aspects a on a.task_id = tt.id
        group by tt.id, tt.max_points`
    );
    expect(sums).toHaveLength(6);
    for (const s of sums) {
      expect(s.n).toBeGreaterThan(0);
      expect(Number(s.aspects)).toBe(Number(s.max_points));
    }
    const judgement = await rows<{ n: number }>("select count(*)::int as n from public.cc_task_aspects where type = 'judgement'");
    expect(judgement[0].n).toBe(2);
  });

  it("allows ZIP uploads up to 300 MB in cc-submissions", async () => {
    const [b] = await rows<{ file_size_limit: string; allowed_mime_types: string[] }>(
      "select file_size_limit, allowed_mime_types from storage.buckets where id = 'cc-submissions'"
    );
    expect(Number(b.file_size_limit)).toBe(314572800);
    expect(b.allowed_mime_types).toContain("application/zip");
    expect(b.allowed_mime_types).toContain("application/step");
  });

  it("hides the staff-only test from students", async () => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [STUDENT]);
    await db.exec("set role authenticated");
    const visible = await rows<{ slug: string }>("select slug from public.cc_tests order by slug");
    expect(visible.map((x) => x.slug)).toEqual(["diagnostic-v1", "practice-cube"]);
    const tasks = await rows<{ n: number }>("select count(*)::int as n from public.cc_test_tasks_public");
    expect(tasks[0].n).toBe(5);
    const hidden = await rows<{ n: number }>("select count(*)::int as n from public.cc_test_tasks");
    expect(hidden[0].n).toBe(0);
    await db.exec("reset role");
  });
});
