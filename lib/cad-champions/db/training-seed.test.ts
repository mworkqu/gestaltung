// Training migration 0083 (Prompt 9): applies 0077 + 0078 + 0080 + 0083 (0083
// twice, to prove it re-runs) inside PGlite with the same Supabase stub as
// rls.test.ts, then checks the catalog, the tags, free access and RLS.
// Never touches Supabase.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GLOSSARY_IDS } from "../glossary";

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
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const COHORT = "cc083000-0000-4000-8000-0000000009c1";
let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function as(user: string | null, fn: () => Promise<void>) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
  try {
    await fn();
  } finally {
    await db.exec("reset role");
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(migration("0077_cc_core.sql"));
  await db.exec(migration("0078_cc_storage.sql"));
  await db.exec(migration("0080_cc_diagnostic_seed.sql"));
  for (let i = 0; i < 2; i++) await db.exec(migration("0083_cc_training_seed.sql"));
  await db.exec(`insert into auth.users (id, email) values ('${STUDENT}', 's@example.com'), ('${OTHER}', 'o@example.com');
                 insert into public.cc_profiles (id, email, full_name) values ('${STUDENT}', 's@example.com', 'Sara Student'), ('${OTHER}', 'o@example.com', 'Omar Other');`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0083 training seed", () => {
  it("creates the course structure once (Orientation, Foundations, M1-M4, mocks)", async () => {
    const mods = await rows<{ slug: string; competition_module: string | null; is_orientation: boolean; levels: number }>(
      `select m.slug, m.competition_module, m.is_orientation, (select count(*)::int from public.cc_levels l where l.module_id = m.id) as levels
         from public.cc_modules m order by m.sort`
    );
    expect(mods.map((m) => [m.slug, m.competition_module, m.levels])).toEqual([
      ["orientation", null, 1],
      ["foundations", null, 6],
      ["m1-fabrication", "M1", 4],
      ["m2-design-challenge", "M2", 5],
      ["m3-assemblies-drawings", "M3", 4],
      ["m4-reverse-engineering", "M4", 4],
      ["mock-competitions", null, 1],
    ]);
    expect(mods[0].is_orientation).toBe(true);
    const [c] = await rows<{ n: number }>("select count(*)::int as n from public.cc_courses");
    expect(c.n).toBe(1);
  });

  it("tags every lesson and exercise with one skill area (and the track's module)", async () => {
    const [l] = await rows<{ n: number; untagged: number }>(
      "select count(*)::int as n, count(*) filter (where skill_area_id is null)::int as untagged from public.cc_lessons"
    );
    expect(l.n).toBe(65);
    expect(l.untagged).toBe(0);
    const [e] = await rows<{ n: number; untagged: number }>(
      "select count(*)::int as n, count(*) filter (where skill_area_id is null)::int as untagged from public.cc_exercises"
    );
    expect(e.n).toBe(18);
    expect(e.untagged).toBe(0);
    const tracks = await rows<{ cm: string | null; lesson_cm: string | null }>(
      `select m.competition_module as cm, le.competition_module as lesson_cm
         from public.cc_lessons le join public.cc_levels l on l.id = le.level_id join public.cc_modules m on m.id = l.module_id
        where m.competition_module is not null`
    );
    expect(tracks.length).toBeGreaterThan(30);
    expect(tracks.every((t) => t.cm === t.lesson_cm)).toBe(true);
  });

  it("uses only known glossary terms and valid track notes", async () => {
    const terms = await rows<{ t: string }>("select distinct unnest(glossary_terms) as t from public.cc_lessons");
    for (const { t } of terms) expect(GLOSSARY_IDS).toContain(t);
    const notes = await rows<{ track_notes: Record<string, unknown> }>("select track_notes from public.cc_lessons where track_notes <> '{}'::jsonb");
    expect(notes.length).toBeGreaterThan(10);
    for (const { track_notes } of notes) {
      for (const [k, v] of Object.entries(track_notes)) {
        expect(["fusion", "solidworks"]).toContain(k);
        if (typeof v === "string") expect(v).toBe("inventor_only");
        else expect(v).toMatchObject({ en: expect.any(String), ar: expect.any(String) });
      }
    }
  });

  it("makes Orientation + Foundations L1 the free preview and L1 exercises the free sample", async () => {
    const free = await rows<{ slug: string }>("select slug from public.cc_lessons where is_free_preview order by slug");
    expect(free.map((x) => x.slug)).toEqual([
      "f1-sketch-and-extrude",
      "f1-units-material-step",
      "how-the-competition-works",
      "how-this-training-works",
      "how-to-study",
    ]);
    const sample = await rows<{ slug: string }>("select slug from public.cc_exercises where is_free_sample order by slug");
    expect(sample.map((x) => x.slug)).toEqual(["e1-profile-lines-arcs", "e1-rectangle-plate"]);
    const [notes] = await rows<{ n: number }>(
      "select count(*)::int as n from public.cc_lessons where slug in ('how-this-training-works', 'how-the-competition-works', 'how-to-study') and length(notes_en) > 200 and length(notes_ar) > 200"
    );
    expect(notes.n).toBe(3);
  });

  it("never names the competition brand in seeded text", async () => {
    const [x] = await rows<{ n: number }>(
      `select count(*)::int as n from public.cc_lessons
        where coalesce(notes_en, '') ilike '%worldskills%' or coalesce(notes_ar, '') ilike '%worldskills%' or title_en ilike '%worldskills%'`
    );
    expect(x.n).toBe(0);
  });

  it("links the L6 mini-project to an unpublished 60-minute exercise test", async () => {
    const [x] = await rows<{ slug: string; time_limit_minutes: number; is_published: boolean; type: string }>(
      `select t.slug, t.time_limit_minutes, t.is_published, t.type
         from public.cc_exercises e join public.cc_tests t on t.id = e.test_id where e.slug = 'e6-mini-project'`
    );
    expect(x).toEqual({ slug: "foundations-mini-project", time_limit_minutes: 60, is_published: false, type: "exercise" });
  });

  it("hides hints from students but shows the hint count", async () => {
    await as(STUDENT, async () => {
      const [base] = await rows<{ n: number }>("select count(*)::int as n from public.cc_exercises");
      expect(base.n).toBe(0);
      const [v] = await rows<Record<string, unknown>>("select * from public.cc_exercises_public where slug = 'e1-rectangle-plate'");
      expect(v.hint_count).toBe(2);
      expect(v).not.toHaveProperty("hints_en");
      expect(v).not.toHaveProperty("reference_data");
    });
  });

  it("hides paid lesson content columns from students", async () => {
    await as(STUDENT, async () => {
      const titles = await rows<{ n: number }>("select count(*)::int as n from (select slug, title_en, objectives_en from public.cc_lessons) x");
      expect(titles[0].n).toBe(65);
      await expect(db.query("select notes_en from public.cc_lessons limit 1")).rejects.toThrow(/permission denied/);
      await expect(db.query("select video_inventor_en from public.cc_lessons limit 1")).rejects.toThrow(/permission denied/);
    });
  });

  it("lets students read only their own XP and badges, and never write them", async () => {
    await db.exec(`insert into public.cc_student_xp (user_id, xp, streak_weeks) values ('${STUDENT}', 30, 2), ('${OTHER}', 10, 1);
                   insert into public.cc_badges (user_id, level_id) select '${STUDENT}', id from public.cc_levels where level_number = 1 limit 1;`);
    await as(STUDENT, async () => {
      const xp = await rows<{ user_id: string }>("select user_id from public.cc_student_xp");
      expect(xp.map((r) => r.user_id)).toEqual([STUDENT]);
      const [badges] = await rows<{ n: number }>("select count(*)::int as n from public.cc_badges");
      expect(badges.n).toBe(1);
      await db.exec(`update public.cc_student_xp set xp = 999 where user_id = '${STUDENT}'`);
    });
    const [after] = await rows<{ xp: number }>(`select xp from public.cc_student_xp where user_id = '${STUDENT}'`);
    expect(after.xp).toBe(30);
  });

  it("verifies a certificate code publicly and counts cohort seats", async () => {
    await db.exec(`insert into public.cc_certificates (user_id, module_id, code)
                   select '${STUDENT}', id, 'CC-ABCD-2345' from public.cc_modules where slug = 'foundations'`);
    await as(null, async () => {
      const [r] = await rows<{ v: Record<string, unknown> | null }>("select public.cc_verify_certificate('cc-abcd-2345') as v");
      expect(r.v).toMatchObject({ code: "CC-ABCD-2345", full_name: "Sara Student", module_title_en: "Foundations" });
      const [none] = await rows<{ v: unknown }>("select public.cc_verify_certificate('CC-NOPE-0000') as v");
      expect(none.v).toBeNull();
    });
    await db.exec(`insert into public.cc_cohorts (id, slug, name_en, name_ar, seats_total, status) values ('${COHORT}', 'c1', 'C1', 'C1', 10, 'open');
                   insert into public.cc_enrollments (user_id, cohort_id, source, ends_at) values ('${STUDENT}', '${COHORT}', 'admin', now() + interval '30 days');`);
    await as(OTHER, async () => {
      const seats = await rows<{ cohort_id: string; seats_taken: number }>("select * from public.cc_cohort_seats()");
      expect(seats).toEqual([{ cohort_id: COHORT, seats_taken: 1 }]);
    });
  });
});
