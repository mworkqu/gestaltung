// Payments migration 0084 (Prompt 10): applies 0077 + 0078 + 0080 + 0083 +
// 0084 (0084 twice, to prove it re-runs) inside PGlite with the same Supabase
// stub as rls.test.ts, then checks the seed, the state machine RPC, seat
// holds, coupons, enrollment on paid, and that a student can't forge any of it.
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
const COHORT = "cc084000-0000-4000-8000-0000000009c1";
const DRAFT_COHORT = "cc084000-0000-4000-8000-0000000009c2";
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

async function planId(slug: string): Promise<string> {
  const [p] = await rows<{ id: string }>("select id from public.cc_plans where slug = $1", [slug]);
  return p.id;
}

async function createPayment(user: string, slug: string, ref: string, cohort: string | null = null, amount = 1000): Promise<{ ok: boolean; id?: string; reason?: string }> {
  return as("service", async () => {
    const [r] = await rows<{ r: { ok: boolean; id?: string; reason?: string } }>(
      `select public.cc_create_payment($1, $2, $3, null, null, $4, 0, 0, $4, 'fawran', $5, now() + interval '48 hours') as r`,
      [user, await planId(slug), cohort, amount, ref],
    );
    return r.r;
  });
}

async function transition(id: string, to: string, actor: string | null, reason: string | null = null, patch: Record<string, unknown> = {}) {
  return as("service", async () => {
    const [r] = await rows<{ r: Record<string, unknown> }>("select public.cc_payment_transition($1, $2, $3, $4, null, $5::jsonb) as r", [id, to, actor, reason, JSON.stringify(patch)]);
    return r.r;
  });
}

const PROOF = { proof_storage_path: `${STUDENT}/x/1_proof.png`, payer_name: "Sara", payer_bank: "qnb", transfer_reference: "FT123", transferred_at: "2026-10-14T09:00:00Z" };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(migration("0077_cc_core.sql"));
  await db.exec(migration("0078_cc_storage.sql"));
  await db.exec(migration("0080_cc_diagnostic_seed.sql"));
  await db.exec(migration("0083_cc_training_seed.sql"));
  for (let i = 0; i < 2; i++) await db.exec(migration("0084_cc_payments.sql"));
  await db.exec(`insert into auth.users (id, email) values ('${STUDENT}', 's@example.com'), ('${OTHER}', 'o@example.com'), ('${ADMIN}', 'a@example.com');
                 insert into public.cc_profiles (id, email, full_name, institution) values
                   ('${STUDENT}', 's@example.com', 'Sara Student', 'Qatar University'),
                   ('${OTHER}', 'o@example.com', 'Omar Other', null),
                   ('${ADMIN}', 'a@example.com', 'Admin', null);
                 update public.cc_profiles set role = 'admin' where id = '${ADMIN}';
                 insert into public.cc_cohorts (id, slug, name_en, name_ar, seats_total, status) values
                   ('${COHORT}', 'spring', 'Spring cohort', 'دفعة الربيع', 1, 'open'),
                   ('${DRAFT_COHORT}', 'draft', 'Draft', 'مسودة', 10, 'draft');`);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("0084 payments", () => {
  it("seeds three plans without prices (Price coming soon) and keeps owner edits on re-run", async () => {
    const plans = await rows<{ slug: string; kind: string; price_qar: string | null; duration_days: number | null; is_active: boolean }>(
      "select slug, kind, price_qar, duration_days, is_active from public.cc_plans order by sort",
    );
    expect(plans.map((p) => [p.slug, p.kind, p.price_qar, p.duration_days, p.is_active])).toEqual([
      ["online", "online", null, null, true],
      ["online-in-person", "online_in_person", null, null, true],
      ["measuring-kit", "kit", null, null, true],
    ]);
    await db.exec("update public.cc_plans set price_qar = 1000, duration_days = 90 where slug in ('online', 'online-in-person')");
    await db.exec(migration("0084_cc_payments.sql"));
    const [p] = await rows<{ price_qar: string }>("select price_qar from public.cc_plans where slug = 'online'");
    expect(Number(p.price_qar)).toBe(1000);
  });

  it("lets anyone read open cohorts, not drafts", async () => {
    const seen = await as(null, () => rows<{ id: string }>("select id from public.cc_cohorts"));
    expect(seen.map((c) => c.id)).toEqual([COHORT]);
  });

  it("refuses the writing RPCs and direct writes from a student", async () => {
    const id = (await createPayment(STUDENT, "online", "CAD-2345")).id!;
    await expect(as(STUDENT, () => rows("select public.cc_payment_transition($1, 'paid', $2)", [id, STUDENT]))).rejects.toThrow(/permission denied/);
    await expect(
      as(STUDENT, async () =>
        rows(
          `select public.cc_create_payment($1, $2, null, null, null, 1, 0, 0, 1, 'fawran', 'CAD-2346', now())`,
          [STUDENT, await planId("online")],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    const updated = await as(STUDENT, () => rows("update public.cc_payments set status = 'paid' where id = $1 returning id", [id]));
    expect(updated).toHaveLength(0);
    await expect(
      as(STUDENT, async () =>
        rows(
          "insert into public.cc_enrollments (user_id, ends_at) values ($1, now() + interval '1 year') returning id",
          [STUDENT],
        ),
      ),
    ).rejects.toThrow();
    const mine = await as(STUDENT, () => rows<{ status: string }>("select status from public.cc_payments where id = $1", [id]));
    expect(mine).toEqual([{ status: "awaiting_transfer" }]);
    const others = await as(OTHER, () => rows("select id from public.cc_payments where id = $1", [id]));
    expect(others).toHaveLength(0);
    await transition(id, "cancelled", STUDENT, "test");
  });

  it("enforces the reference code format", async () => {
    await expect(createPayment(STUDENT, "online", "CAD-0O1I")).rejects.toThrow(/reference_code_format/);
  });

  it("runs the state machine: proof required, then paid once, enrollment + receipt + journey + audit", async () => {
    const id = (await createPayment(STUDENT, "online", "CAD-7K3P")).id!;
    await expect(transition(id, "paid", ADMIN)).rejects.toThrow(/cc_invalid_transition: awaiting_transfer -> paid/);
    await expect(transition(id, "proof_submitted", STUDENT)).rejects.toThrow(/cc_proof_required/);
    await transition(id, "proof_submitted", STUDENT, null, PROOF);
    await expect(transition(id, "rejected", ADMIN, "  ")).rejects.toThrow(/cc_reason_required/);
    const r = await transition(id, "paid", ADMIN);
    expect(r).toMatchObject({ ok: true, from: "proof_submitted", to: "paid", receipt_number: 1001 });
    await expect(transition(id, "paid", ADMIN)).rejects.toThrow(/cc_invalid_transition: paid -> paid/);

    const [pay] = await rows<{ status: string; payer_name: string; reviewed_by: string; paid_at: string | null }>("select status, payer_name, reviewed_by, paid_at from public.cc_payments where id = $1", [id]);
    expect(pay).toMatchObject({ status: "paid", payer_name: "Sara", reviewed_by: ADMIN });
    expect(pay.paid_at).not.toBeNull();
    const enr = await rows<{ days: number }>("select round(extract(epoch from (ends_at - starts_at)) / 86400)::int as days from public.cc_enrollments where payment_id = $1", [id]);
    expect(enr).toEqual([{ days: 90 }]);
    const [active] = await rows<{ a: boolean }>("select public.cc_has_active_enrollment($1) as a", [STUDENT]);
    expect(active.a).toBe(true);
    const [j] = await rows<{ enrolled_at: string | null }>("select enrolled_at from public.cc_journey_progress where user_id = $1", [STUDENT]);
    expect(j.enrolled_at).not.toBeNull();
    const audit = await rows<{ action: string }>("select action from public.cc_audit_log where entity_id = $1 order by created_at", [id]);
    expect(audit.map((a) => a.action)).toEqual(["payment.created", "payment.proof_submitted", "payment.paid"]);
  });

  it("starts a renewal when the current enrollment ends", async () => {
    const id = (await createPayment(STUDENT, "online", "CAD-RENW")).id!;
    await transition(id, "proof_submitted", STUDENT, null, PROOF);
    await transition(id, "paid", ADMIN);
    const e = await rows<{ starts_at: string; ends_at: string }>("select starts_at, ends_at from public.cc_enrollments where user_id = $1 order by starts_at", [STUDENT]);
    expect(e).toHaveLength(2);
    expect(new Date(e[1].starts_at).getTime()).toBe(new Date(e[0].ends_at).getTime());
  });

  it("rejected -> new proof -> paid works; expired is final", async () => {
    const id = (await createPayment(OTHER, "online", "CAD-REJ2")).id!;
    await transition(id, "proof_submitted", OTHER, null, PROOF);
    await transition(id, "rejected", ADMIN, "Not received");
    const [r] = await rows<{ reject_reason: string }>("select reject_reason from public.cc_payments where id = $1", [id]);
    expect(r.reject_reason).toBe("Not received");
    await transition(id, "proof_submitted", OTHER, null, PROOF);
    await transition(id, "paid", ADMIN);

    const exp = (await createPayment(OTHER, "online", "CAD-EXP2")).id!;
    await transition(exp, "expired", null, "reservation_expired");
    await expect(transition(exp, "proof_submitted", OTHER, null, PROOF)).rejects.toThrow(/cc_invalid_transition/);
  });

  it("holds the last cohort seat for an unpaid reservation and releases it on expiry", async () => {
    const first = await createPayment(STUDENT, "online-in-person", "CAD-SEAB", COHORT);
    expect(first.ok).toBe(true);
    expect(await createPayment(OTHER, "online-in-person", "CAD-SEAC", COHORT)).toEqual({ ok: false, reason: "cohort_full" });
    const [seats] = await as(STUDENT, () => rows<{ seats_taken: number }>("select seats_taken from public.cc_cohort_seats() where cohort_id = $1", [COHORT]));
    expect(seats.seats_taken).toBe(1);
    // the same student re-checking out keeps their own seat (old reservation cancelled)
    const again = await createPayment(STUDENT, "online-in-person", "CAD-SEAD", COHORT);
    expect(again.ok).toBe(true);
    const [old] = await rows<{ status: string }>("select status from public.cc_payments where id = $1", [first.id]);
    expect(old.status).toBe("cancelled");
    await transition(again.id!, "expired", null);
    expect((await createPayment(OTHER, "online-in-person", "CAD-SEAE", COHORT)).ok).toBe(true);
    expect(await createPayment(STUDENT, "online-in-person", "CAD-SEAF", DRAFT_COHORT)).toEqual({ ok: false, reason: "cohort_closed" });
  });

  it("validates coupons for the signed-in student without exposing the table", async () => {
    const online = await planId("online");
    const inPerson = await planId("online-in-person");
    await db.exec(`insert into public.cc_coupons (code, discount_type, discount_value, plan_ids, institution, max_uses, used_count, expires_at) values
      ('SCHOOL10', 'percent', 10, array['${online}']::uuid[], 'qatar university', null, 0, null),
      ('OLD', 'fixed', 50, null, null, null, 0, now() - interval '1 day'),
      ('FULL', 'fixed', 50, null, null, 2, 2, null),
      ('BIG', 'fixed', 5000, null, null, null, 0, null)`);
    const check = (user: string, code: string, plan: string) =>
      as(user, async () => (await rows<{ r: Record<string, unknown> }>("select public.cc_validate_coupon($1, $2) as r", [code, plan]))[0].r);
    expect(await check(STUDENT, " school10 ", online)).toMatchObject({ ok: true, code: "SCHOOL10", discount_qar: 100, amount_qar: 900 });
    expect(await check(STUDENT, "SCHOOL10", inPerson)).toEqual({ ok: false, reason: "wrong_plan" });
    expect(await check(OTHER, "SCHOOL10", online)).toEqual({ ok: false, reason: "wrong_institution" });
    expect(await check(STUDENT, "OLD", online)).toEqual({ ok: false, reason: "expired" });
    expect(await check(STUDENT, "FULL", online)).toEqual({ ok: false, reason: "used_up" });
    expect(await check(STUDENT, "NOPE", online)).toEqual({ ok: false, reason: "invalid" });
    expect(await check(STUDENT, "BIG", online)).toMatchObject({ ok: true, discount_qar: 1000, amount_qar: 0 });
    const seen = await as(STUDENT, () => rows("select code from public.cc_coupons"));
    expect(seen).toHaveLength(0);
    await expect(as(null, () => rows("select public.cc_validate_coupon('SCHOOL10', $1)", [online]))).rejects.toThrow(/permission denied/);
  });

  it("refunded cancels the enrollment", async () => {
    const id = (await createPayment(OTHER, "online", "CAD-RFND")).id!;
    await transition(id, "proof_submitted", OTHER, null, PROOF);
    await transition(id, "paid", ADMIN);
    await transition(id, "refunded", ADMIN, "Refund");
    const [e] = await rows<{ status: string }>("select status from public.cc_enrollments where payment_id = $1", [id]);
    expect(e.status).toBe("cancelled");
  });
});
