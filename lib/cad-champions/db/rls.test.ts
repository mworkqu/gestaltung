// RLS tests for the CAD Champions schema (0077_cc_core.sql + 0078_cc_storage.sql).
//
// Runs the REAL migration files, unmodified, inside PGlite (Postgres 17 compiled
// to WASM, in-process, no network, never touches Supabase). A minimal stub of
// what Supabase provides is created first: roles anon / authenticated /
// service_role, schemas auth + storage, auth.users, auth.uid() reading the
// request.jwt.claim.sub setting, public.profiles + public.is_super_admin()
// (copied from 0001), storage.buckets / storage.objects / storage.foldername().
//
// Each check switches identity with:
//   reset role; select set_config('request.jwt.claim.sub', '<uuid>', false); set role authenticated;
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CC_BUCKET_LIMITS } from "./types";

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

const A = "00000000-0000-4000-8000-00000000000a"; // student A
const B = "00000000-0000-4000-8000-00000000000b"; // student B
const C = "00000000-0000-4000-8000-00000000000c"; // new user (no CC profile yet)
const I = "00000000-0000-4000-8000-00000000000e"; // instructor
const M = "00000000-0000-4000-8000-00000000000f"; // CC admin
const S = "00000000-0000-4000-8000-000000000005"; // site super_admin, no CC profile

let db: PGlite;

async function as(uid: string | null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid ?? ""]);
  await db.exec(uid ? "set role authenticated" : "set role anon");
}
async function asSuper() {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
}
async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

let publishedTest = "";
let draftTest = "";
let attemptA = "";

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  // Apply twice to prove the migrations are safe to re-run.
  for (let i = 0; i < 2; i++) {
    await db.exec(migration("0077_cc_core.sql"));
    await db.exec(migration("0078_cc_storage.sql"));
  }

  await db.exec(`
    insert into auth.users (id, email) values
      ('${A}', 'a@example.com'), ('${B}', 'b@example.com'), ('${C}', 'c@example.com'),
      ('${I}', 'i@example.com'), ('${M}', 'm@example.com'), ('${S}', 's@example.com');
    insert into public.profiles (id, role) values ('${S}', 'super_admin'), ('${A}', 'client');
  `);

  // Students create their own profiles through RLS, as the app's server action will.
  for (const [id, email] of [[A, "a@example.com"], [B, "b@example.com"]]) {
    await as(id);
    await db.query("insert into public.cc_profiles (id, email, full_name) values ($1, $2, 'Student')", [id, email]);
  }

  await asSuper();
  await db.exec(`
    insert into public.cc_profiles (id, email, role) values ('${I}', 'i@example.com', 'instructor'), ('${M}', 'm@example.com', 'admin');
    insert into public.cc_help_articles (slug, category, title_en, title_ar, is_published) values
      ('how-the-test-works', 'getting_started', 'How the test works', 'كيف يعمل الاختبار', true),
      ('draft-article', 'account', 'Draft', 'مسودة', false);
  `);
  publishedTest = (await rows<{ id: string }>(
    `insert into public.cc_tests (slug, title_en, title_ar, type, time_limit_minutes, is_published)
     values ('diagnostic-v1', 'Diagnostic', 'تشخيصي', 'diagnostic', 90, true) returning id`))[0].id;
  draftTest = (await rows<{ id: string }>(
    `insert into public.cc_tests (slug, title_en, title_ar, type, is_published)
     values ('draft-test', 'Draft', 'مسودة', 'mock', false) returning id`))[0].id;
  await db.query(
    `insert into public.cc_test_tasks (test_id, position, skill_area_id, title_en, title_ar, expected_upload, max_points, grading_mode, reference_data, rubric)
     values ($1, 1, 3, 'Plate', 'لوح', 'step', 25, 'auto_step', '{"volume": 12345}', '[{"id": "x"}]'),
            ($2, 1, 3, 'Secret', 'سري', 'step', 25, 'auto_step', '{"volume": 1}', null)`,
    [publishedTest, draftTest],
  );
  const course = (await rows<{ id: string }>(`insert into public.cc_courses (slug, title_en, title_ar, is_published) values ('main', 'Main', 'الرئيسي', true) returning id`))[0].id;
  const mod = (await rows<{ id: string }>(`insert into public.cc_modules (course_id, skill_area_id, slug, title_en, title_ar, is_published) values ($1, 3, '3d', '3D', 'ثلاثي', true) returning id`, [course]))[0].id;
  const level = (await rows<{ id: string }>(`insert into public.cc_levels (module_id, level_number, title_en, title_ar, is_published) values ($1, 1, 'L1', 'م1', true) returning id`, [mod]))[0].id;
  await db.query(
    `insert into public.cc_exercises (level_id, slug, title_en, title_ar, reference_data, rubric, hints_en, solution_video_id, is_published)
     values ($1, 'l1-plate', 'Plate', 'لوح', '{"volume": 1}', '[]', array['hint 1', 'hint 2'], 'vid', true)`,
    [level],
  );

  const taskId = (await rows<{ id: string }>(`select id from public.cc_test_tasks where test_id = $1`, [publishedTest]))[0].id;
  attemptA = (await rows<{ id: string }>(`insert into public.cc_attempts (user_id, test_id) values ($1, $2) returning id`, [A, publishedTest]))[0].id;
  const attemptB = (await rows<{ id: string }>(`insert into public.cc_attempts (user_id, test_id) values ($1, $2) returning id`, [B, publishedTest]))[0].id;
  await db.query(
    `insert into public.cc_submissions (attempt_id, task_id, user_id, storage_path, file_name, file_size)
     values ($1, $3, $4, 'a/x.step', 'x.step', 10), ($2, $3, $5, 'b/x.step', 'x.step', 10)`,
    [attemptA, attemptB, taskId, A, B],
  );

  // Marking aspects: one on the published task, one on the draft test's task.
  const draftTaskId = (await rows<{ id: string }>(`select id from public.cc_test_tasks where test_id = $1`, [draftTest]))[0].id;
  await db.query(
    `insert into public.cc_task_aspects (task_id, description_en, description_ar, skill_area_id, competition_module, type, max_points, method, partial_rule, check_key)
     values ($1, 'Volume within 0.5%', 'الحجم ضمن 0.5%', 3, 'M3', 'measurement', 2, 'auto_step', '{"secret": true}', 'volume'),
            ($2, 'Draft aspect', 'مسودة', 3, null, 'judgement', 1, 'trainer', null, null)`,
    [taskId, draftTaskId],
  );
  const aspectId = (await rows<{ id: string }>(`select id from public.cc_task_aspects where task_id = $1`, [taskId]))[0].id;
  const resultA = (await rows<{ id: string }>(
    `insert into public.cc_task_results (attempt_id, task_id, user_id) values ($1, $2, $3) returning id`, [attemptA, taskId, A]))[0].id;
  const resultB = (await rows<{ id: string }>(
    `insert into public.cc_task_results (attempt_id, task_id, user_id) values ($1, $2, $3) returning id`, [attemptB, taskId, B]))[0].id;
  await db.query(
    `insert into public.cc_aspect_results (task_result_id, aspect_id, user_id, passed, points_awarded)
     values ($1, $3, $4, true, 2), ($2, $3, $5, false, 0)`,
    [resultA, resultB, aspectId, A, B],
  );
  await db.exec(`
    insert into storage.objects (bucket_id, name, owner) values
      ('cc-submissions', '${B}/att/task/1_b.step', '${B}'),
      ('cc-payment-proofs', '${B}/pay/1_b.png', '${B}'),
      ('cc-answer-files', 'diagnostic-v1/answer.step', null);
  `);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("cc_profiles", () => {
  it("creates a journey row with each profile", async () => {
    await asSuper();
    const r = await rows("select user_id from public.cc_journey_progress where user_id in ($1, $2)", [A, B]);
    expect(r).toHaveLength(2);
  });

  it("student A cannot read student B's profile", async () => {
    await as(A);
    const r = await rows<{ id: string }>("select id from public.cc_profiles");
    expect(r.map((x) => x.id)).toEqual([A]);
  });

  it("student cannot make themselves admin", async () => {
    await as(A);
    await expect(db.query("update public.cc_profiles set role = 'admin' where id = $1", [A])).rejects.toThrow(/admin/);
    await asSuper();
    expect((await rows<{ role: string }>("select role from public.cc_profiles where id = $1", [A]))[0].role).toBe("student");
  });

  it("student cannot grant themselves a Get Ready bypass", async () => {
    await as(A);
    await expect(db.query("update public.cc_profiles set get_ready_bypass = true where id = $1", [A])).rejects.toThrow();
  });

  it("student can edit own normal fields; is_minor is derived from date_of_birth", async () => {
    await as(A);
    await db.query("update public.cc_profiles set full_name = 'Ali', date_of_birth = (current_date - interval '16 years')::date, is_minor = false where id = $1", [A]);
    const r = await rows<{ full_name: string; is_minor: boolean }>("select full_name, is_minor from public.cc_profiles where id = $1", [A]);
    expect(r[0]).toEqual({ full_name: "Ali", is_minor: true });
  });

  it("guardian_consent_at is stamped by the server clock", async () => {
    await as(A);
    await db.query("update public.cc_profiles set guardian_consent = true, guardian_consent_at = '2000-01-01' where id = $1", [A]);
    const r = await rows<{ y: number }>("select extract(year from guardian_consent_at)::int as y from public.cc_profiles where id = $1", [A]);
    expect(r[0].y).toBeGreaterThan(2000);
  });

  it("student cannot insert a profile for someone else or as admin", async () => {
    await as(C);
    await expect(db.query("insert into public.cc_profiles (id, role) values ($1, 'admin')", [C])).rejects.toThrow();
    await expect(db.query("insert into public.cc_profiles (id) values ($1)", [B])).rejects.toThrow();
    await db.query("insert into public.cc_profiles (id) values ($1)", [C]);
    expect(await rows("select id from public.cc_profiles")).toHaveLength(1);
  });

  it("student cannot write journey timestamps", async () => {
    await as(A);
    const res = await db.query("update public.cc_journey_progress set enrolled_at = now() where user_id = $1", [A]);
    expect(res.affectedRows ?? 0).toBe(0);
    const r = await rows<{ enrolled_at: string | null }>("select enrolled_at from public.cc_journey_progress where user_id = $1", [A]);
    expect(r[0].enrolled_at).toBeNull();
  });

  it("a deletion request marks the profile", async () => {
    await as(A);
    await db.query("insert into public.cc_deletion_requests (user_id, reason) values ($1, 'test')", [A]);
    const r = await rows<{ d: string | null }>("select deletion_requested_at as d from public.cc_profiles where id = $1", [A]);
    expect(r[0].d).not.toBeNull();
  });
});

describe("tests, attempts, submissions", () => {
  it("student A only sees own attempts and submissions", async () => {
    await as(A);
    const att = await rows<{ user_id: string }>("select user_id from public.cc_attempts");
    expect(att.map((x) => x.user_id)).toEqual([A]);
    const sub = await rows<{ user_id: string }>("select user_id from public.cc_submissions");
    expect(sub.map((x) => x.user_id)).toEqual([A]);
  });

  it("student cannot create or change attempts directly", async () => {
    await as(A);
    await expect(db.query("insert into public.cc_attempts (user_id, test_id) values ($1, $2)", [A, draftTest])).rejects.toThrow();
    const res = await db.query("update public.cc_attempts set total_score = 100 where id = $1", [attemptA]);
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it("student gets no rows from cc_test_tasks (answers hidden)", async () => {
    await as(A);
    expect(await rows("select reference_data, rubric from public.cc_test_tasks")).toHaveLength(0);
  });

  it("public view exposes published tasks without answers", async () => {
    await as(A);
    const r = await rows<Record<string, unknown>>("select * from public.cc_test_tasks_public");
    expect(r).toHaveLength(1);
    expect(r[0].title_en).toBe("Plate");
    expect(r[0]).not.toHaveProperty("reference_data");
    expect(r[0]).not.toHaveProperty("rubric");
    expect(r[0]).not.toHaveProperty("tolerances");
    await expect(db.query("select reference_data from public.cc_test_tasks_public")).rejects.toThrow();
  });

  it("exercise view hides answers, hints and the solution video", async () => {
    await as(A);
    expect(await rows("select * from public.cc_exercises")).toHaveLength(0);
    const r = await rows<Record<string, unknown>>("select * from public.cc_exercises_public");
    expect(r).toHaveLength(1);
    expect(r[0].hint_count).toBe(2);
    for (const k of ["reference_data", "rubric", "hints_en", "hints_ar", "solution_video_id"]) expect(r[0]).not.toHaveProperty(k);
  });

  it("student sees only published tests and cannot write tests", async () => {
    await as(A);
    const r = await rows<{ slug: string }>("select slug from public.cc_tests");
    expect(r.map((x) => x.slug)).toEqual(["diagnostic-v1"]);
    await expect(db.query("insert into public.cc_tests (slug, title_en, title_ar, type) values ('x', 'x', 'x', 'mock')")).rejects.toThrow();
  });

  it("instructor reads all student data and answers but cannot write tests", async () => {
    await as(I);
    expect(await rows("select id from public.cc_profiles")).toHaveLength(5);
    expect(await rows("select id from public.cc_attempts")).toHaveLength(2);
    expect(await rows("select id from public.cc_submissions")).toHaveLength(2);
    const t = await rows<{ reference_data: unknown }>("select reference_data from public.cc_test_tasks");
    expect(t).toHaveLength(2);
    expect(await rows("select * from public.cc_test_tasks_public")).toHaveLength(2);
    await expect(db.query("insert into public.cc_tests (slug, title_en, title_ar, type) values ('i', 'i', 'i', 'mock')")).rejects.toThrow();
  });

  it("CC admin can write tests and change roles", async () => {
    await as(M);
    await db.query("insert into public.cc_tests (slug, title_en, title_ar, type) values ('admin-made', 'x', 'x', 'mock')");
    await db.query("update public.cc_profiles set role = 'instructor' where id = $1", [C]);
    await asSuper();
    expect((await rows<{ role: string }>("select role from public.cc_profiles where id = $1", [C]))[0].role).toBe("instructor");
  });

  it("site super_admin is a CC admin without a CC profile", async () => {
    await as(S);
    expect((await rows<{ r: string }>("select public.cc_current_role() as r"))[0].r).toBe("admin");
    await db.query("insert into public.cc_tests (slug, title_en, title_ar, type) values ('super-made', 'x', 'x', 'mock')");
    expect(await rows("select id from public.cc_test_tasks")).toHaveLength(2);
  });

  it("main-site user without a CC profile has no CC role", async () => {
    await as(B);
    expect((await rows<{ r: string }>("select public.cc_current_role() as r"))[0].r).toBe("student");
    await as("00000000-0000-4000-8000-0000000000ff");
    expect((await rows<{ r: string | null }>("select public.cc_current_role() as r"))[0].r).toBeNull();
    expect(await rows("select id from public.cc_profiles")).toHaveLength(0);
  });
});

describe("competition alignment", () => {
  it("seeds M1-M4 readable by anon, with the right hours", async () => {
    await as(null);
    const m = await rows<{ code: string; hours: string }>("select code, hours from public.cc_competition_modules order by position");
    expect(m.map((x) => [x.code, Number(x.hours)])).toEqual([["M1", 6], ["M2", 6], ["M3", 6], ["M4", 4]]);
  });

  it("track_software defaults to inventor and accepts fusion", async () => {
    await as(B);
    expect((await rows<{ t: string }>("select track_software as t from public.cc_profiles where id = $1", [B]))[0].t).toBe("inventor");
    await db.query("update public.cc_profiles set track_software = 'fusion' where id = $1", [B]);
    await expect(db.query("update public.cc_profiles set track_software = 'catia' where id = $1", [B])).rejects.toThrow(/check/);
  });

  it("tests, attempts and submissions carry the new columns", async () => {
    await asSuper();
    const t = await rows<{ upload_mode: string }>("select upload_mode from public.cc_tests where id = $1", [publishedTest]);
    expect(t[0].upload_mode).toBe("per_task");
    const a = await rows<{ in_person: boolean; phase_markers: unknown }>("select in_person, phase_markers from public.cc_attempts where id = $1", [attemptA]);
    expect(a[0]).toEqual({ in_person: false, phase_markers: [] });
    await expect(db.query("update public.cc_tests set upload_mode = 'zip' where id = $1", [publishedTest])).rejects.toThrow(/check/);
  });

  it("an aspect belongs to exactly one task or exercise", async () => {
    await asSuper();
    await expect(db.query(
      `insert into public.cc_task_aspects (description_en, description_ar, skill_area_id, type, max_points, method)
       values ('x', 'x', 3, 'measurement', 1, 'trainer')`)).rejects.toThrow(/one_parent/);
  });

  it("students read aspects of published tests without partial_rule, never the table", async () => {
    await as(A);
    expect(await rows("select * from public.cc_task_aspects")).toHaveLength(0);
    const r = await rows<Record<string, unknown>>("select * from public.cc_task_aspects_public");
    expect(r).toHaveLength(1);
    expect(r[0].check_key).toBe("volume");
    expect(r[0]).not.toHaveProperty("partial_rule");
    await expect(db.query("insert into public.cc_task_aspects (task_id, description_en, description_ar, skill_area_id, type, max_points, method) select task_id, 'x', 'x', 3, 'measurement', 1, 'trainer' from public.cc_task_aspects_public limit 1")).rejects.toThrow();
  });

  it("students read only their own aspect results; staff read all", async () => {
    await as(A);
    const r = await rows<{ user_id: string }>("select user_id from public.cc_aspect_results");
    expect(r.map((x) => x.user_id)).toEqual([A]);
    await as(I);
    expect(await rows("select * from public.cc_aspect_results")).toHaveLength(2);
    expect(await rows("select * from public.cc_task_aspects_public")).toHaveLength(2);
    const res = await db.query("update public.cc_aspect_results set judgement_score = 2 where user_id = $1", [A]);
    expect(res.affectedRows).toBe(1);
  });
});

describe("questions, notes, admin tables", () => {
  it("student can ask but not self-answer or publish", async () => {
    await as(A);
    await db.query("insert into public.cc_lesson_questions (user_id, kind, body) values ($1, 'grade_query', 'Why?')", [A]);
    await expect(db.query("insert into public.cc_lesson_questions (user_id, kind, body, public) values ($1, 'lesson', 'Q', true)", [A])).rejects.toThrow();
    await expect(db.query("insert into public.cc_lesson_questions (user_id, kind, body, status, answer) values ($1, 'lesson', 'Q', 'answered', 'A')", [A])).rejects.toThrow();
    await as(B);
    expect(await rows("select id from public.cc_lesson_questions")).toHaveLength(0);
  });

  it("trainer notes, grading logs, coupons and audit log are hidden from students", async () => {
    await as(I);
    await db.query("insert into public.cc_student_notes (student_id, author_id, body) values ($1, $2, 'note')", [A, I]);
    await as(A);
    for (const t of ["cc_student_notes", "cc_grading_logs", "cc_integrity_flags", "cc_coupons", "cc_audit_log", "cc_help_searches"]) {
      expect(await rows(`select * from public.${t}`)).toHaveLength(0);
    }
  });
});

describe("anon", () => {
  it("reads skill areas and published help only", async () => {
    await as(null);
    const sa = await rows<{ code: number; weight_percent: string }>("select code, weight_percent from public.cc_skill_areas order by code");
    expect(sa.map((x) => x.code)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sa.reduce((s, x) => s + Number(x.weight_percent), 0)).toBe(100);
    const h = await rows<{ slug: string }>("select slug from public.cc_help_articles");
    expect(h.map((x) => x.slug)).toEqual(["how-the-test-works"]);
  });

  it("cannot read profiles, tests or the task view", async () => {
    await as(null);
    await expect(db.query("select * from public.cc_profiles")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.cc_tests")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.cc_test_tasks_public")).rejects.toThrow(/permission denied/);
  });
});

describe("storage", () => {
  it("creates five private buckets", async () => {
    await asSuper();
    const b = await rows<{ id: string; public: boolean; file_size_limit: string }>("select id, public, file_size_limit from storage.buckets order by id");
    expect(b.map((x) => x.id)).toEqual(["cc-answer-files", "cc-lesson-files", "cc-payment-proofs", "cc-submissions", "cc-task-files"]);
    expect(b.every((x) => x.public === false)).toBe(true);
    for (const x of b) expect(Number(x.file_size_limit)).toBe(CC_BUCKET_LIMITS[x.id as keyof typeof CC_BUCKET_LIMITS]);
  });

  it("student uploads only into own folder and reads only own files", async () => {
    await as(A);
    await db.query("insert into storage.objects (bucket_id, name) values ('cc-submissions', $1)", [`${A}/att/task/1_a.step`]);
    await expect(db.query("insert into storage.objects (bucket_id, name) values ('cc-submissions', $1)", [`${B}/att/task/2_x.step`])).rejects.toThrow();
    const own = await rows<{ name: string }>("select name from storage.objects where bucket_id = 'cc-submissions'");
    expect(own.map((x) => x.name)).toEqual([`${A}/att/task/1_a.step`]);
    expect(await rows("select name from storage.objects where bucket_id = 'cc-payment-proofs'")).toHaveLength(0);
    expect(await rows("select name from storage.objects where bucket_id = 'cc-answer-files'")).toHaveLength(0);
  });

  it("student cannot delete or overwrite a submitted file", async () => {
    await as(A);
    const res = await db.query("delete from storage.objects where bucket_id = 'cc-submissions'");
    expect(res.affectedRows ?? 0).toBe(0);
  });

  it("staff read submissions; only admins read payment proofs", async () => {
    await as(I);
    expect(await rows("select name from storage.objects where bucket_id = 'cc-submissions'")).toHaveLength(2);
    expect(await rows("select name from storage.objects where bucket_id = 'cc-payment-proofs'")).toHaveLength(0);
    expect(await rows("select name from storage.objects where bucket_id = 'cc-answer-files'")).toHaveLength(1);
    await as(M);
    expect(await rows("select name from storage.objects where bucket_id = 'cc-payment-proofs'")).toHaveLength(1);
  });
});
