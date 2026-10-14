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

// ============================================================================
// Prompt 12 Step A: launch RLS audit against the FULL CC chain (0077-0085).
// Own PGlite instance so the 0077/0078-only checks above stay unchanged.
// Cases that document a real gap are `it.skip` with a pointer to the finding
// in docs/cad-champions/SECURITY_REVIEW.md (fix SQL there; migrations are not
// edited by this review).
// ============================================================================
describe("launch audit: full chain 0077-0085", () => {
  let f: PGlite;
  const PLAN = "cc120000-0000-4000-8000-000000000001";
  const PAY_A = "cc120000-0000-4000-8000-0000000000a1";
  const PAY_B = "cc120000-0000-4000-8000-0000000000b1";
  let attA = "";
  let attB = "";
  let taskId = "";

  async function who(uid: string | null | "service") {
    await f.exec("reset role");
    await f.query("select set_config('request.jwt.claim.sub', $1, false)", [uid && uid !== "service" ? uid : ""]);
    await f.exec(uid === "service" ? "set role service_role" : uid ? "set role authenticated" : "set role anon");
  }
  async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
    return (await f.query<T>(sql, params)).rows;
  }

  beforeAll(async () => {
    f = new PGlite();
    await f.exec(SUPABASE_STUB);
    for (const m of ["0077_cc_core.sql", "0078_cc_storage.sql", "0080_cc_diagnostic_seed.sql", "0081_cc_results.sql",
                     "0082_cc_drawing_rubric.sql", "0083_cc_training_seed.sql", "0084_cc_payments.sql", "0085_cc_admin.sql",
                     "0086_cc_security.sql"]) {
      await f.exec(migration(m));
    }
    await f.exec(`
      insert into auth.users (id, email) values ('${A}', 'a@x.test'), ('${B}', 'b@x.test'), ('${I}', 'i@x.test'), ('${M}', 'm@x.test');
      insert into public.cc_profiles (id, email, full_name, role) values
        ('${A}', 'a@x.test', 'Alice Student', 'student'), ('${B}', 'b@x.test', 'Bob Student', 'student'),
        ('${I}', 'i@x.test', 'Ian Trainer', 'instructor'), ('${M}', 'm@x.test', 'Mo Admin', 'admin');
      insert into public.cc_plans (id, slug, name_en, name_ar, price_qar, duration_days, is_active)
        values ('${PLAN}', 'sec-plan', 'Plan', 'خطة', 100, 30, true);
      insert into public.cc_coupons (code, discount_type, discount_value) values ('SECRET50', 'percent', 50);
      insert into public.cc_payments (id, user_id, plan_id, amount_qar, method, reference_code, status, proof_storage_path, payer_name)
        values ('${PAY_A}', '${A}', '${PLAN}', 100, 'fawran', 'CAD-AAAA', 'proof_submitted', '${A}/${PAY_A}/1_a.png', 'Alice'),
               ('${PAY_B}', '${B}', '${PLAN}', 100, 'fawran', 'CAD-BBBB', 'proof_submitted', '${B}/${PAY_B}/1_b.png', 'Bob');
      insert into public.cc_student_notes (student_id, author_id, body) values ('${A}', '${I}', 'private trainer note');
      insert into public.cc_audit_log (actor_id, action, entity_type) values ('${M}', 'payment.approve', 'cc_payments');
      insert into public.cc_help_searches (query, locale) values ('step', 'en');
      insert into public.cc_announcements (subject_en, subject_ar, body_en, body_ar) values ('s', 'ع', 'b', 'ن');
      insert into public.cc_student_xp (user_id, xp) values ('${A}', 10), ('${B}', 20);
      insert into public.cc_deletion_requests (user_id, reason) values ('${B}', 'bye');
      insert into storage.objects (bucket_id, name, owner) values
        ('cc-payment-proofs', '${A}/${PAY_A}/1_a.png', '${A}'),
        ('cc-payment-proofs', '${B}/${PAY_B}/1_b.png', '${B}'),
        ('cc-submissions', '${B}/att/task/1_b.step', '${B}'),
        ('cc-answer-files', 'diag/answer.step', null),
        ('cc-lesson-files', 'paid-lesson/notes.pdf', null),
        ('cc-task-files', 'draft-test/drawing.pdf', null);
    `);
    const test = (await q<{ id: string }>(
      `insert into public.cc_tests (slug, title_en, title_ar, type, is_published) values ('sec-test', 'T', 'ت', 'mock', true) returning id`))[0].id;
    taskId = (await q<{ id: string }>(
      `insert into public.cc_test_tasks (test_id, skill_area_id, title_en, title_ar, expected_upload, grading_mode, reference_data, rubric, tolerances)
       values ($1, 3, 'Part', 'قطعة', 'step', 'auto_step', '{"volume": 4242}', '[{"id": "r1", "answer": "x"}]', '{"volume_pct": 0.5}') returning id`, [test]))[0].id;
    attA = (await q<{ id: string }>(`insert into public.cc_attempts (user_id, test_id, status, share_enabled, share_token, band)
       values ($1, $2, 'graded', true, 'tok_aaaaaaaaaaaaaaaaaaaaaaa', 'developing') returning id`, [A, test]))[0].id;
    attB = (await q<{ id: string }>(`insert into public.cc_attempts (user_id, test_id, status) values ($1, $2, 'graded') returning id`, [B, test]))[0].id;
    await f.query(`insert into public.cc_grading_logs (kind, response) values ('step', '{"measured_volume": 4242}')`);
    // Student B's private results, files and progress (student A must see none of it).
    const ex = (await q<{ id: string; level_id: string }>("select id, level_id from public.cc_exercises limit 1"))[0];
    const mod = (await q<{ id: string }>("select id from public.cc_modules limit 1"))[0];
    await f.query(`insert into public.cc_submissions (attempt_id, user_id, storage_path, file_name, file_size) values ($1, $2, 'b/x.step', 'x.step', 10)`, [attB, B]);
    await f.query(`insert into public.cc_task_results (attempt_id, task_id, user_id) values ($1, $2, $3)`, [attB, taskId, B]);
    await f.query(`insert into public.cc_skill_scores (attempt_id, skill_area_id, user_id) values ($1, 3, $2)`, [attB, B]);
    await f.query(`insert into public.cc_exercise_attempts (user_id, exercise_id) values ($1, $2)`, [B, ex.id]);
    await f.query(`insert into public.cc_level_unlocks (user_id, level_id) values ($1, $2)`, [B, ex.level_id]);
    await f.query(`insert into public.cc_certificates (user_id, module_id, code) values ($1, $2, 'CERTBBBB')`, [B, mod.id]);
    await f.query(`insert into public.cc_lesson_questions (user_id, kind, body) values ($1, 'lesson', 'private question from B')`, [B]);
    await f.query(`insert into public.cc_integrity_flags (attempt_id, user_id, kind) values ($1, $2, 'too_fast')`, [attB, B]);
  }, 120_000);

  afterAll(async () => {
    await f?.close();
  });

  it("answers stay staff-only after every migration: task reference_data / rubric / tolerances", async () => {
    await who(A);
    expect(await q("select id from public.cc_test_tasks")).toHaveLength(0);
    const cols = (await q<Record<string, unknown>>("select * from public.cc_test_tasks_public where title_en = 'Part'"))[0];
    expect(cols).toBeDefined();
    for (const k of ["reference_data", "rubric", "tolerances"]) expect(cols).not.toHaveProperty(k);
    await who(I);
    expect((await q<{ reference_data: unknown }>("select reference_data from public.cc_test_tasks where title_en = 'Part'"))[0].reference_data).toEqual({ volume: 4242 });
  });

  it("locked hints, exercise answers and solution videos stay staff-only (seeded 0083 exercises)", async () => {
    await who(A);
    expect(await q("select id from public.cc_exercises")).toHaveLength(0);
    const ex = await q<Record<string, unknown>>("select * from public.cc_exercises_public limit 5");
    expect(ex.length).toBeGreaterThan(0);
    for (const row of ex) {
      for (const k of ["hints_en", "hints_ar", "reference_data", "rubric", "tolerances", "solution_video_id"]) expect(row).not.toHaveProperty(k);
    }
  });

  it("paid lesson columns (notes, videos, downloads) are not selectable with a student session", async () => {
    await who(A);
    expect((await q("select id, title_en from public.cc_lessons limit 1")).length).toBeGreaterThan(0);
    for (const col of ["notes_en", "common_mistakes_en", "downloads", "video_inventor_en", "video_neutral_en"]) {
      await expect(q(`select ${col} from public.cc_lessons limit 1`)).rejects.toThrow(/permission denied/);
    }
  });

  it("grading logs (raw measured values), trainer notes, audit log, help searches, announcements: none reach a student", async () => {
    await who(A);
    for (const t of ["cc_grading_logs", "cc_student_notes", "cc_audit_log", "cc_help_searches", "cc_announcements",
                     "cc_announcement_deliveries", "cc_coupons", "cc_integrity_flags"]) {
      expect(await q(`select * from public.${t}`), t).toHaveLength(0);
    }
    await expect(q("insert into public.cc_audit_log (actor_id, action, entity_type) values ($1, 'x', 'y')", [A])).rejects.toThrow(/row-level security/);
    await expect(q("insert into public.cc_student_notes (student_id, author_id, body) values ($1, $1, 'x')", [A])).rejects.toThrow(/row-level security/);
  });

  it("instructor reads trainer notes and grading logs but not the audit log, coupons or announcements", async () => {
    await who(I);
    expect(await q("select id from public.cc_student_notes")).toHaveLength(1);
    expect(await q("select id from public.cc_grading_logs")).toHaveLength(1);
    expect(await q("select id from public.cc_audit_log")).toHaveLength(0);
    expect(await q("select id from public.cc_coupons")).toHaveLength(0);
    expect(await q("select id from public.cc_announcements")).toHaveLength(0);
    await expect(q("insert into public.cc_content_overrides (key, locale, value) values ('msg:x.y', 'en', 'v')")).rejects.toThrow(/row-level security/);
  });

  it("student A sees only own payments, attempts, xp and deletion requests; cannot write payments", async () => {
    await who(A);
    expect((await q<{ id: string }>("select id from public.cc_payments")).map((r) => r.id)).toEqual([PAY_A]);
    expect((await q<{ id: string }>("select id from public.cc_attempts")).map((r) => r.id)).toEqual([attA]);
    expect(await q("select user_id from public.cc_student_xp")).toEqual([{ user_id: A }]);
    expect(await q("select id from public.cc_deletion_requests")).toHaveLength(0);
    expect(await q("update public.cc_payments set status = 'paid' returning id")).toHaveLength(0);
    expect(await q("update public.cc_attempts set total_score = 999 where id = $1 returning id", [attB])).toHaveLength(0);
    await expect(q(`insert into public.cc_enrollments (user_id, ends_at) values ($1, now() + interval '1 year')`, [A])).rejects.toThrow(/row-level security/);
    await expect(q("insert into public.cc_student_xp (user_id, xp) values ($1, 99999)", [A])).rejects.toThrow(/row-level security|duplicate key/);
  });

  it("server-only RPCs are not executable by students or anon", async () => {
    for (const uid of [A, null]) {
      await who(uid);
      await expect(q("select public.cc_payment_transition($1, 'paid', null, null, null, null)", [PAY_A])).rejects.toThrow(/permission denied/);
      await expect(q("select public.cc_anonymise_profile($1, $1, null)", [A])).rejects.toThrow(/permission denied/);
      await expect(q("select public.cc_sync_rubric_aspects($1)", [PAY_A])).rejects.toThrow(/permission denied/);
      await expect(q("select public.cc_help_feedback('x', true)")).rejects.toThrow(/permission denied/);
    }
  });

  it("anon cannot validate coupons, read payments, attempts or the task view", async () => {
    await who(null);
    await expect(q("select public.cc_validate_coupon('SECRET50', $1)", [PLAN])).rejects.toThrow(/permission denied/);
    for (const t of ["cc_payments", "cc_attempts", "cc_coupons", "cc_test_tasks_public", "cc_exercises_public", "cc_student_notes"]) {
      await expect(q(`select * from public.${t}`), t).rejects.toThrow(/permission denied/);
    }
  });

  it("a shared result exposes only first name, band and area scores", async () => {
    await who(null);
    const r = (await q<{ r: Record<string, unknown> }>("select public.cc_shared_result('tok_aaaaaaaaaaaaaaaaaaaaaaa') as r"))[0].r;
    expect(Object.keys(r).sort()).toEqual(["areas", "band", "first_name", "first_name_ar"]);
    expect(r.first_name).toBe("Alice");
    expect((await q<{ r: unknown }>("select public.cc_shared_result('tok_bbbbbbbbbbbbbbbbbbbbbbb') as r"))[0].r).toBeNull();
  });

  it("storage: payment proofs are owner + admin only (instructors and student B cannot read A's)", async () => {
    await who(B);
    expect((await q<{ name: string }>("select name from storage.objects where bucket_id = 'cc-payment-proofs'")).map((r) => r.name)).toEqual([`${B}/${PAY_B}/1_b.png`]);
    await expect(q("insert into storage.objects (bucket_id, name) values ('cc-payment-proofs', $1)", [`${A}/${PAY_A}/2_evil.png`])).rejects.toThrow(/row-level security/);
    await who(I);
    expect(await q("select name from storage.objects where bucket_id = 'cc-payment-proofs'")).toHaveLength(0);
    await who(M);
    expect(await q("select name from storage.objects where bucket_id = 'cc-payment-proofs'")).toHaveLength(2);
  });

  it("storage: answer files are staff-only; students cannot write task, lesson or answer buckets", async () => {
    await who(A);
    expect(await q("select name from storage.objects where bucket_id = 'cc-answer-files'")).toHaveLength(0);
    expect(await q("select name from storage.objects where bucket_id = 'cc-submissions'")).toHaveLength(0);
    for (const b of ["cc-task-files", "cc-lesson-files", "cc-answer-files"]) {
      await expect(q("insert into storage.objects (bucket_id, name) values ($1, $2)", [b, `${A}/x.step`]), b).rejects.toThrow(/row-level security/);
    }
    await who(I);
    expect(await q("select name from storage.objects where bucket_id = 'cc-answer-files'")).toHaveLength(1);
  });

  it("student A cannot read student B's submissions, results, scores, exercise attempts, unlocks, certificates, flags or private questions", async () => {
    await who(A);
    for (const t of ["cc_submissions", "cc_task_results", "cc_skill_scores", "cc_aspect_results", "cc_exercise_attempts",
                     "cc_level_unlocks", "cc_certificates", "cc_lesson_progress", "cc_integrity_flags", "cc_lesson_questions",
                     "cc_journey_progress", "cc_get_ready_steps"]) {
      expect(await q(`select * from public.${t} where user_id = $1`, [B]), t).toHaveLength(0);
    }
    expect(await q("select id from public.cc_profiles where id = $1", [B])).toHaveLength(0);
    expect(await q("update public.cc_task_results set status = 'final' where user_id = $1 returning id", [B])).toHaveLength(0);
    expect(await q("delete from public.cc_submissions where user_id = $1 returning id", [B])).toHaveLength(0);
    expect(await q("update public.cc_profiles set full_name = 'x' where id = $1 returning id", [B])).toHaveLength(0);
    await who(B);
    expect(await q("select id from public.cc_task_results")).toHaveLength(1);
    expect(await q("select id from public.cc_integrity_flags")).toHaveLength(0);
  });

  it("students cannot write results, certificates, unlocks, submissions or exercise attempts for themselves", async () => {
    await who(A);
    const ex = (await q<{ id: string; level_id: string }>("select id, level_id from public.cc_exercises_public limit 1"))[0];
    const mod = (await q<{ id: string }>("select id from public.cc_modules limit 1"))[0];
    await expect(q("insert into public.cc_task_results (attempt_id, task_id, user_id, status) values ($1, $2, $3, 'final')", [attA, taskId, A])).rejects.toThrow(/row-level security/);
    await expect(q("insert into public.cc_exercise_attempts (user_id, exercise_id) values ($1, $2)", [A, ex.id])).rejects.toThrow(/row-level security/);
    await expect(q("insert into public.cc_level_unlocks (user_id, level_id) values ($1, $2)", [A, ex.level_id])).rejects.toThrow(/row-level security/);
    await expect(q("insert into public.cc_certificates (user_id, module_id, code) values ($1, $2, 'FORGED01')", [A, mod.id])).rejects.toThrow(/row-level security/);
    await expect(q("insert into public.cc_submissions (attempt_id, user_id, storage_path, file_name, file_size) values ($1, $2, 'a/y.step', 'y.step', 1)", [attA, A])).rejects.toThrow(/row-level security/);
    expect(await q("update public.cc_attempts set status = 'graded', band = 'advanced' where id = $1 returning id", [attA])).toHaveLength(0);
  });

  it("students and instructors cannot write admin tables (coupons, plans, announcements, testimonials, overrides, flags, audit)", async () => {
    for (const uid of [A, I]) {
      await who(uid);
      await expect(q("insert into public.cc_coupons (code, discount_type, discount_value) values ('MINE100', 'percent', 100)"), `coupon ${uid}`).rejects.toThrow(/row-level security/);
      await expect(q("insert into public.cc_announcements (subject_en, subject_ar, body_en, body_ar) values ('s', 's', 'b', 'b')"), `ann ${uid}`).rejects.toThrow(/row-level security/);
      await expect(q("insert into public.cc_testimonials (quote_en, name_en, is_published) values ('q', 'n', true)"), `testimonial ${uid}`).rejects.toThrow(/row-level security/);
      await expect(q("insert into public.cc_content_overrides (key, locale, value) values ('msg:x.y', 'en', 'v')"), `override ${uid}`).rejects.toThrow(/row-level security/);
      await expect(q("insert into public.cc_integrity_flags (attempt_id, kind) values ($1, 'other')", [attA]), `flag ${uid}`).rejects.toThrow(/row-level security/);
      expect(await q("update public.cc_plans set price_qar = 1 returning id"), `plan ${uid}`).toHaveLength(0);
      expect(await q("update public.cc_coupons set discount_value = 100 returning id"), `coupon upd ${uid}`).toHaveLength(0);
      expect(await q("update public.cc_integrity_flags set resolved_at = now() returning id"), `flag upd ${uid}`).toHaveLength(0);
      expect(await q("delete from public.cc_audit_log returning id"), `audit del ${uid}`).toHaveLength(0);
    }
  });

  it("anon reads no private table, answer table or view", async () => {
    await who(null);
    for (const t of ["cc_test_tasks", "cc_exercises", "cc_task_aspects", "cc_task_aspects_public", "cc_submissions", "cc_task_results",
                     "cc_grading_logs", "cc_integrity_flags", "cc_audit_log", "cc_announcements", "cc_lesson_questions", "cc_enrollments",
                     "cc_lessons", "cc_profiles", "cc_certificates"]) {
      await expect(q(`select * from public.${t}`), t).rejects.toThrow(/permission denied/);
    }
  });

  it("public certificate check returns only name, module and date for an exact code", async () => {
    await who(null);
    const r = (await q<{ r: Record<string, unknown> }>("select public.cc_verify_certificate('certbbbb') as r"))[0].r;
    expect(Object.keys(r).sort()).toEqual(["code", "full_name", "full_name_ar", "issued_at", "module_title_ar", "module_title_en"]);
    expect((await q<{ r: unknown }>("select public.cc_verify_certificate('CERTB') as r"))[0].r).toBeNull();
  });

  // SR-L5: answered public FAQ questions expose the asker's user id (no name: profiles stay private).
  it("documents SR-L5: a public answered FAQ row carries the asker's user_id", async () => {
    await who(I);
    await q("update public.cc_lesson_questions set status = 'answered', answer = 'a', public = true where user_id = $1", [B]);
    await who(A);
    expect(await q("select user_id from public.cc_lesson_questions where user_id = $1", [B])).toHaveLength(1);
    expect(await q("select id from public.cc_profiles where id = $1", [B])).toHaveLength(0);
    await who(I);
    await q("update public.cc_lesson_questions set status = 'open', answer = null, public = false where user_id = $1", [B]);
  });

  // ---- documented gaps (see SECURITY_REVIEW.md; fix SQL there) ----------------

  // SR-H1 (FIXED by 0086): paid lesson files and every test's task files were
  // readable and listable by any signed-in user. Now staff-only; the app signs
  // URLs with the service role after its own access check.
  it("SR-H1: students cannot read or list lesson files or task files; staff can", async () => {
    for (const uid of [A, B]) {
      await who(uid);
      expect(await q("select name from storage.objects where bucket_id = 'cc-lesson-files'")).toHaveLength(0);
      expect(await q("select name from storage.objects where bucket_id = 'cc-task-files'")).toHaveLength(0);
    }
    await who(null);
    await expect(q("select name from storage.objects")).rejects.toThrow(/permission denied/);
    await who(I);
    expect(await q("select name from storage.objects where bucket_id in ('cc-lesson-files', 'cc-task-files')")).toHaveLength(2);
  });

  // SR-M2: cc_validate_coupon is executable by `authenticated`, so coupon codes
  // can be brute-forced through PostgREST /rpc without the app's rate limit.
  it.skip("GAP SR-M2: students cannot call cc_validate_coupon directly", async () => {
    await who(A);
    await expect(q("select public.cc_validate_coupon('SECRET50', $1)", [PLAN])).rejects.toThrow(/permission denied/);
  });

  // SR-L1: instructors read every payment row (payer name, bank, transfer reference).
  it.skip("GAP SR-L1: instructors cannot read payment rows", async () => {
    await who(I);
    expect(await q("select id from public.cc_payments")).toHaveLength(0);
  });

  // SR-L2: cc_has_active_enrollment(p_user) answers for any user id.
  it.skip("GAP SR-L2: a student cannot ask whether another student is enrolled", async () => {
    await who(A);
    await expect(q("select public.cc_has_active_enrollment($1)", [B])).rejects.toThrow(/permission denied/);
  });

  // SR-L3: a student can insert the grader-only Get Ready key directly.
  it.skip("GAP SR-L3: a student cannot self-insert the practice_upload Get Ready step", async () => {
    await who(A);
    await expect(q("insert into public.cc_get_ready_steps (user_id, step_key) values ($1, 'practice_upload')", [A])).rejects.toThrow(/row-level security/);
  });

  // SR-L4: a grade query may point at another student's attempt.
  it.skip("GAP SR-L4: a grade query can only reference the asker's own attempt", async () => {
    await who(A);
    await expect(
      q("insert into public.cc_lesson_questions (user_id, kind, attempt_id, body) values ($1, 'grade_query', $2, 'why?')", [A, attB]),
    ).rejects.toThrow(/row-level security/);
  });

  // The gaps above are real today: these prove it, so the skips cannot rot silently.
  it("documents current behaviour of the gaps (flip with the fixes)", async () => {
    await who(A);
    expect((await q<{ r: { ok: boolean } }>("select public.cc_validate_coupon('SECRET50', $1) as r", [PLAN]))[0].r.ok).toBe(true);
    expect(await q("select public.cc_has_active_enrollment($1)", [B])).toHaveLength(1);
    expect(await q("insert into public.cc_get_ready_steps (user_id, step_key) values ($1, 'practice_upload') returning step_key", [A])).toHaveLength(1);
    expect(
      await q("insert into public.cc_lesson_questions (user_id, kind, attempt_id, body) values ($1, 'grade_query', $2, 'why?') returning id", [A, attB]),
    ).toHaveLength(1);
    await who(I);
    expect(await q("select id from public.cc_payments")).toHaveLength(2);
  });
});
