// Migration 0082 (drawing rubric): applies 0077 + 0078 + 0080 + 0081 + 0082
// (0082 twice) in PGlite with the same Supabase stub as seed-0080.test.ts and
// checks the rubric, its aspects and cc_sync_rubric_aspects(). Never touches Supabase.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { defaultRubric } from "../drawing/rubric";

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

const TASK = "cc080000-0000-4000-8000-000000000104";
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
  await db.exec(migration("0080_cc_diagnostic_seed.sql"));
  await db.exec(migration("0081_cc_results.sql"));
  // Twice, to prove it is safe to re-run.
  for (let i = 0; i < 2; i++) await db.exec(migration("0082_cc_drawing_rubric.sql"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type AspectRow = { id: string; check_key: string; type: string; method: string; max_points: string; position: number; description_en: string; student_hint_ar: string | null };

describe("0082 drawing rubric", () => {
  it("stores the default part rubric on the diagnostic drawing task", async () => {
    const [t] = await rows<{ rubric: unknown; max_points: string }>("select rubric, max_points from public.cc_test_tasks where id = $1", [TASK]);
    expect(t.rubric).toEqual(defaultRubric("part"));
    expect(Number(t.max_points)).toBe(25);
  });

  it("creates one aspect per rubric item, summing to the task max", async () => {
    const aspects = await rows<AspectRow>("select * from public.cc_task_aspects where task_id = $1 order by position", [TASK]);
    const items = defaultRubric("part").items;
    expect(aspects.map((a) => a.check_key)).toEqual(items.map((i) => `rubric:${i.id}`));
    expect(aspects.reduce((s, a) => s + Number(a.max_points), 0)).toBe(25);
    expect(aspects.filter((a) => a.type === "judgement").map((a) => a.check_key)).toEqual(["rubric:presentation", "rubric:readability"]);
    expect(aspects.filter((a) => a.method === "ai_drawing")).toHaveLength(13);
    const key = aspects.find((a) => a.check_key === "rubric:key_dimensions")!;
    expect(key.method).toBe("trainer");
    expect(key.type).toBe("measurement");
    for (const a of aspects) expect(a.student_hint_ar).toBeTruthy();
  });

  it("keeps the ids of the aspects seeded by 0080", async () => {
    const [a] = await rows<AspectRow>("select * from public.cc_task_aspects where task_id = $1 and check_key = 'rubric:title_block'", [TASK]);
    expect(a.id).toBe("cc080000-0000-4000-8000-000000001401");
  });

  it("sync removes rubric aspects whose item was removed, keeps results of kept items", async () => {
    await db.exec(`
      insert into auth.users (id, email) values ('${STUDENT}', 's@example.com');
      insert into public.cc_profiles (id, email, full_name) values ('${STUDENT}', 's@example.com', 'Student');
      insert into public.cc_attempts (id, user_id, test_id, status)
        select 'aaaaaaaa-0000-4000-8000-000000000001', '${STUDENT}', test_id, 'submitted' from public.cc_test_tasks where id = '${TASK}';
      insert into public.cc_task_results (id, attempt_id, task_id, user_id, status)
        values ('bbbbbbbb-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001', '${TASK}', '${STUDENT}', 'ai_pending_review');
      insert into public.cc_aspect_results (task_result_id, aspect_id, user_id, passed, points_awarded)
        values ('bbbbbbbb-0000-4000-8000-000000000001', 'cc080000-0000-4000-8000-000000001401', '${STUDENT}', true, 2);
      update public.cc_test_tasks
         set rubric = jsonb_set(rubric, '{items}', (select jsonb_agg(i) from jsonb_array_elements(rubric -> 'items') i where i ->> 'id' <> 'gdt'))
       where id = '${TASK}';
    `);
    const [{ n }] = await rows<{ n: number }>("select public.cc_sync_rubric_aspects($1) as n", [TASK]);
    expect(n).toBe(15);
    const keys = (await rows<AspectRow>("select check_key from public.cc_task_aspects where task_id = $1", [TASK])).map((a) => a.check_key);
    expect(keys).not.toContain("rubric:gdt");
    const results = await rows("select * from public.cc_aspect_results where task_result_id = 'bbbbbbbb-0000-4000-8000-000000000001'");
    expect(results).toHaveLength(1);
  });

  it("sync is service-role only", async () => {
    const [{ ok }] = await rows<{ ok: boolean }>(
      "select has_function_privilege('authenticated', 'public.cc_sync_rubric_aspects(uuid)', 'execute') as ok"
    );
    expect(ok).toBe(false);
  });
});
