// Admin migration 0085 (Prompt 11): applies 0077 + 0078 + 0080 + 0083 + 0084 +
// 0085 (0085 twice, to prove it re-runs) inside PGlite with the same Supabase
// stub as payments-migration.test.ts, then checks public reads, that a
// student cannot write the admin tables, that an admin can, and that
// cc_anonymise_profile is service_role only and does what it says.
// Never touches Supabase.
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
const ADMIN = "00000000-0000-4000-8000-0000000000c3";
const GHOST = "00000000-0000-4000-8000-0000000000d4";
const ANN = "cc085000-0000-4000-8000-0000000000a1";
let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function as<T>(user: string | null | "service", fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
  try {
    return await fn();
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
  await db.exec(migration("0083_cc_training_seed.sql"));
  await db.exec(migration("0084_cc_payments.sql"));
  for (let i = 0; i < 2; i++) await db.exec(migration("0085_cc_admin.sql"));
  await db.exec(`insert into auth.users (id, email) values ('${STUDENT}', 's@example.com'), ('${OTHER}', 'o@example.com'), ('${ADMIN}', 'a@example.com');
                 insert into public.cc_profiles (id, email, full_name, full_name_ar, phone, institution, institution_other, date_of_birth, guardian_name, guardian_phone, marketing_consent, weekly_progress_email) values
                   ('${STUDENT}', 's@example.com', 'Sara Student', 'سارة', '+97455551234', 'other', 'Some College', '2010-05-01', 'Parent', '+97455550000', true, true),
                   ('${OTHER}', 'o@example.com', 'Omar Other', null, null, null, null, null, null, null, false, true),
                   ('${ADMIN}', 'a@example.com', 'Admin', null, null, null, null, null, null, null, false, true);
                 update public.cc_profiles set role = 'admin' where id = '${ADMIN}';
                 insert into public.cc_content_overrides (key, locale, value) values ('msg:get-ready.welcome.autoNote', 'en', 'Hello');
                 insert into public.cc_testimonials (id, quote_en, quote_ar, name_en, name_ar, is_published) values
                   ('cc085000-0000-4000-8000-000000000001', 'Great', 'رائع', 'A', 'أ', true),
                   ('cc085000-0000-4000-8000-000000000002', 'Draft quote', 'مسودة', 'B', 'ب', false);
                 insert into public.cc_announcements (id, subject_en, subject_ar, body_en, body_ar) values ('${ANN}', 'S', 'ع', 'B', 'ن');`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0085 admin: reads", () => {
  it("lets anon read overrides and only published testimonials", async () => {
    const o = await as(null, () => rows<{ value: string }>("select value from public.cc_content_overrides"));
    expect(o).toEqual([{ value: "Hello" }]);
    const t = await as(null, () => rows<{ quote_en: string }>("select quote_en from public.cc_testimonials"));
    expect(t).toEqual([{ quote_en: "Great" }]);
    expect(await as(STUDENT, () => rows("select id from public.cc_testimonials"))).toHaveLength(1);
    expect(await as(ADMIN, () => rows("select id from public.cc_testimonials"))).toHaveLength(2);
  });

  it("keeps announcements away from anon and students", async () => {
    await expect(as(null, () => rows("select id from public.cc_announcements"))).rejects.toThrow(/permission denied/);
    expect(await as(STUDENT, () => rows("select id from public.cc_announcements"))).toHaveLength(0);
    expect(await as(ADMIN, () => rows("select id from public.cc_announcements"))).toHaveLength(1);
  });
});

describe("0085 admin: writes", () => {
  it("refuses a student writing overrides, testimonials, announcements and deliveries", async () => {
    await expect(as(STUDENT, () => rows("insert into public.cc_content_overrides (key, locale, value) values ('msg:x.y', 'en', 'v')"))).rejects.toThrow(/row-level security/);
    expect(await as(STUDENT, () => rows("update public.cc_content_overrides set value = 'hacked' returning key"))).toHaveLength(0);
    expect(await as(STUDENT, () => rows("delete from public.cc_content_overrides returning key"))).toHaveLength(0);
    await expect(as(STUDENT, () => rows("insert into public.cc_testimonials (quote_en, is_published) values ('x', true)"))).rejects.toThrow(/row-level security/);
    expect(await as(STUDENT, () => rows("update public.cc_testimonials set is_published = true returning id"))).toHaveLength(0);
    await expect(
      as(STUDENT, () => rows("insert into public.cc_announcements (subject_en, subject_ar, body_en, body_ar) values ('a', 'b', 'c', 'd')")),
    ).rejects.toThrow(/row-level security/);
    await expect(
      as(STUDENT, () => rows("insert into public.cc_announcement_deliveries (announcement_id, user_id) values ($1, $2)", [ANN, STUDENT])),
    ).rejects.toThrow(/row-level security/);
    const [o] = await rows<{ value: string }>("select value from public.cc_content_overrides where key = 'msg:get-ready.welcome.autoNote'");
    expect(o.value).toBe("Hello");
  });

  it("lets an admin write all four tables", async () => {
    await as(ADMIN, () => rows("insert into public.cc_content_overrides (key, locale, value) values ('video:landing.intro', 'en', 'youtube:abc')"));
    expect(await as(ADMIN, () => rows("update public.cc_content_overrides set value = 'youtube:def' where key = 'video:landing.intro' returning key"))).toHaveLength(1);
    await as(ADMIN, () => rows("insert into public.cc_testimonials (quote_en, quote_ar, is_published) values ('q', 'ق', true)"));
    expect(await as(ADMIN, () => rows("update public.cc_testimonials set is_published = false where quote_en = 'q' returning id"))).toHaveLength(1);
    const [a] = await as(ADMIN, () =>
      rows<{ id: string }>("insert into public.cc_announcements (subject_en, subject_ar, body_en, body_ar, created_by) values ('a', 'ب', 'c', 'د', $1) returning id", [ADMIN]),
    );
    await as(ADMIN, () => rows("insert into public.cc_announcement_deliveries (announcement_id, user_id) values ($1, $2)", [a.id, STUDENT]));
    // the primary key makes a re-run safe: the same recipient twice is refused
    await expect(as(ADMIN, () => rows("insert into public.cc_announcement_deliveries (announcement_id, user_id) values ($1, $2)", [a.id, STUDENT]))).rejects.toThrow(/duplicate key/);
    expect(await as(ADMIN, () => rows("update public.cc_announcement_deliveries set status = 'sent', sent_at = now() where announcement_id = $1 returning user_id", [a.id]))).toHaveLength(1);
  });
});

describe("0085 admin: cc_anonymise_profile", () => {
  it("is service_role only", async () => {
    for (const who of [null, STUDENT, ADMIN] as const) {
      await expect(as(who, () => rows("select public.cc_anonymise_profile($1, $2, 'x')", [STUDENT, ADMIN]))).rejects.toThrow(/permission denied/);
    }
    const [p] = await rows<{ email: string }>("select email from public.cc_profiles where id = $1", [STUDENT]);
    expect(p.email).toBe("s@example.com");
  });

  it("reports not_found for an unknown user", async () => {
    const [r] = await as("service", () => rows<{ r: { ok: boolean; reason?: string } }>("select public.cc_anonymise_profile($1, $2, null) as r", [GHOST, ADMIN]));
    expect(r.r).toEqual({ ok: false, reason: "not_found" });
  });

  it("blanks personal data, approves the request and writes the audit row", async () => {
    await db.exec(`insert into public.cc_deletion_requests (user_id, reason) values ('${STUDENT}', 'please delete');
                   insert into public.cc_student_notes (student_id, author_id, body) values ('${STUDENT}', '${ADMIN}', 'private note');
                   insert into public.cc_lesson_questions (user_id, kind, body, image_path) values ('${STUDENT}', 'lesson', 'my question', '${STUDENT}/questions/a.png');`);
    const [plan] = await rows<{ id: string }>("select id from public.cc_plans where slug = 'online'");
    await as("service", () =>
      rows("select public.cc_create_payment($1, $2, null, null, null, 100, 0, 0, 100, 'fawran', 'CAD-7K3P', now() + interval '48 hours')", [STUDENT, plan.id]),
    );
    await db.exec(`update public.cc_payments set payer_name = 'Sara', proof_storage_path = '${STUDENT}/p/1.png', raw_payload = '{"a":1}'::jsonb where user_id = '${STUDENT}'`);

    const [r] = await as("service", () => rows<{ r: { ok: boolean; request_id: string | null } }>("select public.cc_anonymise_profile($1, $2, 'done') as r", [STUDENT, ADMIN]));
    expect(r.r.ok).toBe(true);
    expect(r.r.request_id).toBeTruthy();

    const [p] = await rows<Record<string, unknown>>("select * from public.cc_profiles where id = $1", [STUDENT]);
    expect(p).toMatchObject({
      email: null,
      full_name: "Deleted user",
      full_name_ar: null,
      phone: null,
      institution: null,
      institution_other: null,
      date_of_birth: null,
      guardian_name: null,
      guardian_phone: null,
      marketing_consent: false,
      weekly_progress_email: false,
    });
    expect(await rows("select id from public.cc_student_notes where student_id = $1", [STUDENT])).toHaveLength(0);
    const [q] = await rows<{ body: string; image_path: string | null }>("select body, image_path from public.cc_lesson_questions where user_id = $1", [STUDENT]);
    expect(q).toEqual({ body: "[deleted]", image_path: null });
    const [pay] = await rows<{ payer_name: string | null; proof_storage_path: string | null; raw_payload: unknown }>(
      "select payer_name, proof_storage_path, raw_payload from public.cc_payments where user_id = $1",
      [STUDENT],
    );
    expect(pay).toEqual({ payer_name: null, proof_storage_path: null, raw_payload: null });

    const [req] = await rows<{ status: string; processed_by: string; processed_at: string | null; admin_note: string }>(
      "select status, processed_by, processed_at, admin_note from public.cc_deletion_requests where user_id = $1",
      [STUDENT],
    );
    expect(req).toMatchObject({ status: "approved", processed_by: ADMIN, admin_note: "done" });
    expect(req.processed_at).not.toBeNull();

    const audit = await rows<{ actor_id: string; entity_type: string; entity_id: string; before: { fields_cleared: string[] }; after: { request_id: string } }>(
      "select actor_id, entity_type, entity_id, before, after from public.cc_audit_log where action = 'account.anonymise'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor_id: ADMIN, entity_type: "cc_profiles", entity_id: STUDENT });
    expect(audit[0].before.fields_cleared).toContain("email");
    expect(audit[0].after.request_id).toBe(r.r.request_id);
  });

  it("is safe to call twice (no pending request the second time)", async () => {
    const [r] = await as("service", () => rows<{ r: { ok: boolean; request_id: string | null } }>("select public.cc_anonymise_profile($1, $2, null) as r", [STUDENT, ADMIN]));
    expect(r.r.ok).toBe(true);
    expect(r.r.request_id ?? null).toBeNull();
  });
});
