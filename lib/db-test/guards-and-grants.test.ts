// Migration 0103 (audit 2026-10): one before/after case per section — DB-07,
// DB-08, DB-10, DB-11, DB-12, DB-13, DB-16, DB-17, DB-18, DB-19, DB-22, API-02.
// The stub carries the ORIGINAL function bodies, copied from the migrations
// 0103 replaces (migrationFunction), with their original grants, on top of
// Supabase's default privileges; the BEFORE cases show each hole, then 0103
// is applied twice and the AFTER cases show it closed. Never touches Supabase.
// (Lives here, not under lib/security/, which another change owns.)
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, migrationFunction as f, pgliteDb } from "./pglite";

const STUB = `
${SUPABASE_BASE_STUB}
alter table public.profiles add column phone text, add column full_name text;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'p',
  status text not null default 'active',
  is_test boolean not null default false,
  tenant_id uuid,
  contact_email text,
  recovery_token uuid,
  recovery_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create policy projects_select on public.projects for select using (user_id = auth.uid() or public.is_super_admin());
create policy projects_insert on public.projects for insert with check (user_id = auth.uid());
create policy projects_update on public.projects for update
  using (user_id = auth.uid() or public.is_super_admin()) with check (user_id = auth.uid() or public.is_super_admin());

create table public.project_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null, actor uuid, type text not null, detail jsonb, created_at timestamptz not null default now()
);
${f("0033_order_links_and_delete_fix.sql", "log_project_event")}
revoke all on function public.log_project_event(uuid, text, jsonb) from public;

-- class helpers (0096 shapes)
create table public.school_classes (id uuid primary key default gen_random_uuid(), teacher_id uuid not null);
create table public.class_teams (id uuid primary key default gen_random_uuid(), class_id uuid not null, project_id uuid not null);
${f("0096_school_classes.sql", "class_teacher_of_project")}
${f("0096_school_classes.sql", "is_class_project")}
${f("0096_school_classes.sql", "is_class_teacher_of_project")}
revoke all on function public.class_teacher_of_project(uuid), public.is_class_project(uuid), public.is_class_teacher_of_project(uuid) from public;
grant execute on function public.class_teacher_of_project(uuid), public.is_class_project(uuid), public.is_class_teacher_of_project(uuid) to anon, authenticated;
-- 0096's teacher-read policy, as created there (no TO clause)
create policy projects_select_class_teacher on public.projects for select using (public.is_class_teacher_of_project(id));

${f("0045_project_recovery_link.sql", "project_recovery_begin")}
revoke all on function public.project_recovery_begin(uuid, text) from public;
grant execute on function public.project_recovery_begin(uuid, text) to authenticated;
${f("0045_project_recovery_link.sql", "claim_project")}

-- credits / tokens / engineering jobs (0042, 0088, 0089, 0091)
create table public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('wiring', 'cad', 'idea', 'idea_pass')),
  delta integer not null, reason text, note text, created_by uuid,
  created_at timestamptz not null default now()
);
create unique index credits_ledger_idea_welcome_once on public.credits_ledger (user_id) where kind = 'idea' and reason = 'idea_welcome';
create unique index credits_ledger_purchase_once on public.credits_ledger (user_id, kind, reason) where reason like 'purchase:%';
create function public.credit_balance_of(p_user uuid, p_kind text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from public.credits_ledger where user_id = p_user and kind = p_kind;
$$;
create table public.idea_passes (user_id uuid primary key, active_until timestamptz not null);
${f("0089_payments_maker_pass.sql", "idea_pass_sweep")}
create table public.engineering_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid, user_id uuid not null, kind text not null, status text not null default 'queued',
  tokens integer not null default 0, payment_id uuid, eta_at timestamptz, snapshot jsonb, note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
${f("0091_engineering_jobs.sql", "engineering_job_submit")}
${f("0091_engineering_jobs.sql", "engineering_job_refund_internal")}
${f("0091_engineering_jobs.sql", "engineering_job_cancel")}
revoke all on function public.engineering_job_cancel(uuid) from public, anon;

-- claim_guest_work (0071) and what it moves
create table public.cart_items (id uuid primary key default gen_random_uuid(), user_id uuid, product_id uuid, project_id uuid, kit_id uuid, quantity integer, bom_lines text[] default '{}');
create table public.client_inventory_items (id uuid primary key default gen_random_uuid(), user_id uuid, product_id uuid, quantity integer);
create table public.project_kits (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.cad_generations (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.analysis_runs (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.sourcing_gaps (id uuid primary key default gen_random_uuid(), user_id uuid);
create table public.demand_signals (id uuid primary key default gen_random_uuid(), user_id uuid);

-- orders (0011, 0044)
create table public.part_orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid, customer_name text not null default 'c', customer_phone text not null, customer_email text,
  payment_method text, created_at timestamptz not null default now(),
  -- 0097: 0103's line cap exempts class orders, so the guard reads this column.
  class_id uuid
);
create table public.part_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.part_orders (id) on delete cascade,
  quantity integer not null check (quantity > 0)
);
${f("0071_claim_guest_work.sql", "claim_guest_work")}
revoke all on function public.claim_guest_work(uuid, uuid) from public, anon, authenticated;
${f("0044_shipping_flat_free_threshold.sql", "is_plausible_email")}
${f("0044_shipping_flat_free_threshold.sql", "set_order_payment_method")}
revoke all on function public.set_order_payment_method(uuid, text) from public;
grant execute on function public.set_order_payment_method(uuid, text) to anon, authenticated;

-- create_part_order's inserts, as the SECURITY DEFINER RPC makes them
create function public.test_place_order(p_phone text, p_email text, p_qty integer, p_lines integer, p_class uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.part_orders (profile_id, customer_phone, customer_email, class_id) values (auth.uid(), p_phone, p_email, p_class) returning id into v_id;
  for i in 1..p_lines loop insert into public.part_order_items (order_id, quantity) values (v_id, p_qty); end loop;
  return v_id;
end $$;

-- inquiries (0002 + 0031)
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text not null, email text, message text not null,
  locale text not null default 'en',
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.inquiries enable row level security;
create policy inquiries_insert on public.inquiries for insert to anon, authenticated with check (true);

-- sourcing (0028, 0095, 0098)
create table public.store_settings (key text primary key, value jsonb not null);
insert into public.store_settings values ('fx_to_qar', '{"QAR": 1, "USD": 3.64}'), ('margin_floor_pct', '15'), ('commission_floor_pct', '8');
create table public.suppliers (id uuid primary key default gen_random_uuid(), active boolean not null default true, rank integer, commission_percent numeric, landed_overhead_pct numeric not null default 10);
create table public.parts (
  id uuid primary key default gen_random_uuid(), unit_price numeric not null default 10, pack_size integer not null default 1,
  pricing_mode text not null default 'markup', pinned_offer_id uuid, preferred_offer_id uuid,
  landed_cost_qar numeric, expected_income_qar numeric, income_pct numeric, below_floor boolean not null default false, lead_time_class text
);
create table public.supplier_offers (
  id uuid primary key default gen_random_uuid(), part_id uuid not null, supplier_id uuid not null,
  active boolean not null default true, availability text default 'in_stock', lead_time_days integer default 2,
  retail_price numeric, currency text not null default 'USD', pack_size integer not null default 1, cost numeric not null,
  created_at timestamptz not null default now()
);
${f("0028_suppliers_and_offers.sql", "offer_landed_cost_qar")}
${f("0098_commission_floor.sql", "refresh_part_sourcing")}
revoke all on function public.refresh_part_sourcing(uuid) from public, anon;
grant execute on function public.refresh_part_sourcing(uuid) to authenticated;
revoke all on function public.offer_landed_cost_qar(uuid) from public;
grant execute on function public.offer_landed_cost_qar(uuid) to authenticated;
-- the sourcing trigger path (0028 supplier_offers_refresh_trg shape)
create function public.test_offers_refresh_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin perform public.refresh_part_sourcing(new.part_id); return new; end $$;
create trigger test_offers_refresh after insert or update on public.supplier_offers
  for each row execute function public.test_offers_refresh_trg();
`;

const ADMIN = "00000000-0000-4000-8000-00000000ad01";
const U1 = "00000000-0000-4000-8000-000000000101";
const U2 = "00000000-0000-4000-8000-000000000102";
const TEACHER = "00000000-0000-4000-8000-000000000103";
const GUEST = "00000000-0000-4000-8000-000000000104";
const GUEST2 = "00000000-0000-4000-8000-000000000105";

const { db, rows, as, fails, applyTwice } = pgliteDb();
const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0];

async function newProject(owner: string, extra: Record<string, unknown> = {}) {
  const cols = ["user_id", ...Object.keys(extra)];
  const vals = [owner, ...Object.values(extra)];
  const r = await one<{ id: string }>(
    `insert into public.projects (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    vals,
  );
  return r.id;
}

/** A job paid with Maker Pass tokens, then cancelled by its owner; the refund rows. */
async function passJobCancelled() {
  const project = await newProject(U1);
  await db.query("insert into public.credits_ledger (user_id, kind, delta, reason) values ($1, 'idea_pass', 10, 'pass:x')", [U1]);
  const job = await as("service", () =>
    one<{ id: string }>("select (public.engineering_job_submit($1, $2, 'step_model', 6, '{}'::jsonb, null, 3, false, null)).id", [U1, project]),
  );
  await as(U1, () => db.query("select public.engineering_job_cancel($1)", [job.id]));
  return rows<{ kind: string; delta: number }>("select kind, delta from public.credits_ledger where reason = $1", [`job_refund:${job.id}`]);
}

/** Guest with a welcome row + account with one; the claim result. */
async function claimWithTwoWelcomes(guest: string) {
  await db.query("insert into public.credits_ledger (user_id, kind, delta, reason) values ($1, 'idea', 5, 'idea_welcome')", [guest]);
  await db.query(
    "insert into public.credits_ledger (user_id, kind, delta, reason) values ($1, 'idea', 5, 'idea_welcome') on conflict do nothing",
    [U2],
  );
  await newProject(guest);
  return as("service", () => fails("select public.claim_guest_work($1, $2)", [guest, U2]));
}

const tenOrders = (phone: string) => as(null, async () => {
  for (let i = 0; i < 10; i++) await db.query("select public.test_place_order($1, null, 1, 1)", [phone]);
});

async function recoveryEmails(email: string, users: string[]) {
  const out: string[] = [];
  for (const u of users) {
    const p = await newProject(u);
    const r = await as(u, () => one<{ r: { ok: boolean; reason?: string } }>("select public.project_recovery_begin($1, $2) as r", [p, email]));
    out.push(r.r.ok ? "ok" : r.r.reason!);
  }
  return out;
}

async function classProjectWithToken() {
  const p = await newProject(GUEST, { recovery_token: "00000000-0000-4000-8000-0000000000aa" });
  const c = await one<{ id: string }>("insert into public.school_classes (teacher_id) values ($1) returning id", [TEACHER]);
  await db.query("insert into public.class_teams (class_id, project_id) values ($1, $2)", [c.id, p]);
  return p;
}

async function sourcingPart() {
  const s = await one<{ id: string }>("insert into public.suppliers default values returning id");
  const p = await one<{ id: string }>("insert into public.parts default values returning id");
  const o = await one<{ id: string }>("insert into public.supplier_offers (part_id, supplier_id, cost) values ($1, $2, 1) returning id", [p.id, s.id]);
  return { part: p.id, offer: o.id };
}

describe("0103_guards_and_grants", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec(`
      insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
        ('${ADMIN}', 'a@x.qa', now(), false), ('${U1}', 'u1@x.qa', now(), false), ('${U2}', 'u2@x.qa', now(), false),
        ('${TEACHER}', 't@x.qa', now(), false), ('${GUEST}', null, null, true), ('${GUEST2}', null, null, true);
      insert into public.profiles (id, role) values ('${ADMIN}', 'super_admin'), ('${U1}', 'client'), ('${U2}', 'client'),
        ('${TEACHER}', 'client'), ('${GUEST}', 'client'), ('${GUEST2}', 'client');
      insert into public.idea_passes values ('${U1}', now() + interval '10 days');
    `);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  describe("BEFORE 0103 (the holes)", () => {
    it("DB-07: a cancelled pass-paid job refunds permanent idea tokens", async () => {
      expect(await passJobCancelled()).toEqual([{ kind: "idea", delta: 6 }]);
    });
    it("DB-08: claim_guest_work aborts when guest and account both hold idea_welcome", async () => {
      expect(await claimWithTwoWelcomes(GUEST2)).toMatch(/duplicate key|unique/);
    });
    it("DB-10: unbounded quantity and order count", async () => {
      expect(await as(null, () => fails("select public.test_place_order('+974 5555 0001', null, 99999, 1)"))).toBeNull();
      await tenOrders("+974 5555 0002");
      expect(await as(null, () => fails("select public.test_place_order('97455550002', null, 1, 1)"))).toBeNull();
    });
    it("DB-11: anyone writes events into any project's timeline", async () => {
      const p = await newProject(U1);
      expect(await as(null, () => fails("select public.log_project_event($1, 'fake', '{}')", [p]))).toBeNull();
      expect(await as(U2, () => fails("select public.log_project_event($1, 'fake', '{}')", [p]))).toBeNull();
    });
    it("DB-12: the owner sets is_test", async () => {
      const p = await newProject(U1);
      await as(U1, () => db.query("update public.projects set is_test = true where id = $1", [p]));
      expect((await one<{ is_test: boolean }>("select is_test from public.projects where id = $1", [p])).is_test).toBe(true);
    });
    it("DB-13: a teacher holding the token takes over a guest's class project", async () => {
      const p = await classProjectWithToken();
      const r = await as(TEACHER, () => one<{ r: { ok: boolean } }>("select public.claim_project($1, '00000000-0000-4000-8000-0000000000aa') as r", [p]));
      expect(r.r.ok).toBe(true);
    });
    it("DB-16: anon inserts a 9000-char lead with status closed and is_test", async () => {
      await as(null, () =>
        db.query("insert into public.inquiries (name, phone, message, status, is_test) values ('n', '1', $1, 'closed', true)", ["x".repeat(9000)]),
      );
      expect(await rows("select 1 from public.inquiries where status = 'closed' and is_test")).toHaveLength(1);
    });
    it("DB-17: another user sets the payment method of my order", async () => {
      const o = await as(U1, () => one<{ id: string }>("select public.test_place_order('+974 1', null, 1, 1) as id"));
      expect((await as(U2, () => one<{ r: boolean }>("select public.set_order_payment_method($1, 'fawran') as r", [o.id]))).r).toBe(true);
    });
    it("DB-18 / DB-19: any client refreshes sourcing; anon reads supplier landed cost", async () => {
      const { part, offer } = await sourcingPart();
      expect(await as(U1, () => fails("select public.refresh_part_sourcing($1)", [part]))).toBeNull();
      expect(Number((await as(null, () => one<{ c: string }>("select public.offer_landed_cost_qar($1) as c", [offer]))).c)).toBeGreaterThan(0);
    });
    it("DB-22: anon reads a project's teacher id", async () => {
      expect(await as(null, () => fails("select public.class_teacher_of_project(gen_random_uuid())"))).toBeNull();
    });
    it("DB-13: a class team project still gets a recovery e-mail (its link can never be claimed)", async () => {
      const p = await classProjectWithToken();
      const r = await as(GUEST, () => one<{ r: { ok: boolean } }>("select public.project_recovery_begin($1, 'team@x.qa') as r", [p]));
      expect(r.r.ok).toBe(true);
    });
    it("API-02: a new session resets the 3-per-day cap for the same address", async () => {
      expect(await recoveryEmails("victim@x.qa", [U1, U1, U1, U2])).toEqual(["ok", "ok", "ok", "ok"]);
    });
  });

  describe("AFTER 0103", () => {
    beforeAll(async () => {
      await applyTwice("0103_guards_and_grants.sql");
    });

    it("DB-07: the refund comes back as idea_pass", async () => {
      expect(await passJobCancelled()).toEqual([{ kind: "idea_pass", delta: 6 }]);
    });

    it("DB-08: the claim succeeds and the account keeps exactly one welcome row", async () => {
      expect(await claimWithTwoWelcomes(GUEST)).toBeNull();
      expect(await rows("select 1 from public.credits_ledger where user_id = $1 and reason = 'idea_welcome'", [U2])).toHaveLength(1);
      expect(await rows("select 1 from public.credits_ledger where user_id = $1", [GUEST])).toHaveLength(0);
      // claim_guest_work still logs through log_project_event (SECURITY DEFINER caller, DB-11)
      expect((await rows("select 1 from public.project_events where type = 'project_claimed'")).length).toBeGreaterThan(0);
    });

    it("DB-10: quantity <= 1000, <= 300 lines, <= 10 orders per hour per phone/email", async () => {
      await db.exec("delete from public.part_orders");
      expect(await as(null, () => fails("select public.test_place_order('+974 6666 0001', null, 1001, 1)"))).toMatch(/quantity_too_large/);
      expect(await as(null, () => fails("select public.test_place_order('+974 6666 0001', null, 1000, 1)"))).toBeNull();
      // Owner decision 2026-10-24 (DB-10c): the cap is 300 lines, not 100.
      expect(await as(null, () => fails("select public.test_place_order('+974 6666 0003', null, 1, 101)"))).toBeNull();
      expect(await as(null, () => fails("select public.test_place_order('+974 6666 0004', null, 1, 301)"))).toMatch(/too_many_lines/);
      // ... and a class order is exempt from the line cap altogether: one teacher
      // orders for every team in one go. The per-line quantity cap still applies.
      expect(
        await as(null, () => fails("select public.test_place_order('+974 6666 0005', null, 1, 301, gen_random_uuid())")),
      ).toBeNull();
      expect(
        await as(null, () => fails("select public.test_place_order('+974 6666 0006', null, 1001, 1, gen_random_uuid())")),
      ).toMatch(/quantity_too_large/);
      await db.exec("delete from public.part_orders");
      await tenOrders("+974 6666 0002");
      expect(await as(null, () => fails("select public.test_place_order('97466660002', null, 1, 1)"))).toMatch(/too_many_orders/);
      // Matched on the last 8 digits: the local form and the 00974 form are the same phone.
      expect(await as(null, () => fails("select public.test_place_order('66660002', null, 1, 1)"))).toMatch(/too_many_orders/);
      expect(await as(null, () => fails("select public.test_place_order('0097466660002', null, 1, 1)"))).toMatch(/too_many_orders/);
      expect(await as(null, () => fails("select public.test_place_order('+974 6666 0012', null, 1, 1)"))).toBeNull();
      expect(await as(null, () => fails("select public.test_place_order('+974 6666 0009', null, 1, 1)"))).toBeNull();
      for (let i = 0; i < 10; i++) await as(null, () => db.query("select public.test_place_order($1, 'Same@x.qa', 1, 1)", [`+974 70${i}`]));
      expect(await as(null, () => fails("select public.test_place_order('+974 7999', 'same@x.qa', 1, 1)"))).toMatch(/too_many_orders/);
      expect(await as(ADMIN, () => fails("select public.test_place_order('97466660002', null, 5000, 1)"))).toBeNull(); // admin exempt
    });

    it("DB-11: anon/authenticated cannot call log_project_event; SECURITY DEFINER callers still log", async () => {
      const p = await newProject(U1);
      expect(await as(null, () => fails("select public.log_project_event($1, 'fake', '{}')", [p]))).toMatch(/permission denied/);
      expect(await as(U1, () => fails("select public.log_project_event($1, 'fake', '{}')", [p]))).toMatch(/permission denied/);
    });

    it("DB-12: the owner cannot set is_test / tenant_id (update or insert); an admin can", async () => {
      const p = await newProject(U1);
      await as(U1, () => db.query("update public.projects set is_test = true, tenant_id = gen_random_uuid(), name = 'renamed' where id = $1", [p]));
      expect(await one("select is_test, tenant_id, name from public.projects where id = $1", [p])).toEqual({ is_test: false, tenant_id: null, name: "renamed" });
      const q = await as(U1, () => one<{ id: string }>("insert into public.projects (user_id, is_test) values ($1, true) returning id", [U1]));
      expect((await one<{ is_test: boolean }>("select is_test from public.projects where id = $1", [q.id])).is_test).toBe(false);
      await as(ADMIN, () => db.query("update public.projects set is_test = true where id = $1", [p]));
      expect((await one<{ is_test: boolean }>("select is_test from public.projects where id = $1", [p])).is_test).toBe(true);
    });

    it("DB-13: project_recovery_begin refuses a class team project (invalid); other guest projects still get one", async () => {
      const p = await classProjectWithToken();
      const r = await as(GUEST, () => one<{ r: { ok: boolean; reason: string } }>("select public.project_recovery_begin($1, 'team2@x.qa') as r", [p]));
      expect(r.r).toEqual({ ok: false, reason: "invalid" });
      expect((await one<{ recovery_emailed_at: string | null }>("select recovery_emailed_at from public.projects where id = $1", [p])).recovery_emailed_at).toBeNull();
      const q = await newProject(GUEST2);
      const ok = await as(GUEST2, () => one<{ r: { ok: boolean } }>("select public.project_recovery_begin($1, 'guest2@x.qa') as r", [q]));
      expect(ok.r.ok).toBe(true);
    });

    it("DB-13: claim_project refuses a class team project (invalid)", async () => {
      const p = await classProjectWithToken();
      const r = await as(TEACHER, () => one<{ r: { ok: boolean; reason: string } }>("select public.claim_project($1, '00000000-0000-4000-8000-0000000000aa') as r", [p]));
      expect(r.r).toEqual({ ok: false, reason: "invalid" });
      expect((await one<{ user_id: string }>("select user_id from public.projects where id = $1", [p])).user_id).toBe(GUEST);
    });

    it("DB-16: over-long fields are refused; status / is_test forced on public inserts", async () => {
      const ins = (msg: string) =>
        as(null, () => fails("insert into public.inquiries (name, phone, message, status, is_test) values ('n2', '1', $1, 'closed', true)", [msg]));
      expect(await ins("x".repeat(8001))).toMatch(/inquiries_field_lengths/);
      expect(await as(null, () => fails("insert into public.inquiries (name, phone, message) values ($1, '1', 'm')", ["n".repeat(121)]))).toMatch(/inquiries_field_lengths/);
      expect(await ins("x".repeat(8000))).toBeNull();
      expect(await one("select status, is_test from public.inquiries where name = 'n2'")).toEqual({ status: "new", is_test: false });
      // the old 9000-char row is still there (constraint is NOT VALID)
      expect(await rows("select 1 from public.inquiries where char_length(message) = 9000")).toHaveLength(1);
    });

    it("DB-17: only the order's own session sets the payment method", async () => {
      const o = await as(U1, () => one<{ id: string }>("select public.test_place_order('+974 2', null, 1, 1) as id"));
      expect((await as(U2, () => one<{ r: boolean }>("select public.set_order_payment_method($1, 'fawran') as r", [o.id]))).r).toBe(false);
      expect((await as(U1, () => one<{ r: boolean }>("select public.set_order_payment_method($1, 'fawran') as r", [o.id]))).r).toBe(true);
      const g = await as(null, () => one<{ id: string }>("select public.test_place_order('+974 3', null, 1, 1) as id"));
      expect((await as(null, () => one<{ r: boolean }>("select public.set_order_payment_method($1, 'cash_on_delivery') as r", [g.id]))).r).toBe(true);
    });

    it("DB-18: clients cannot refresh sourcing; admin, service_role and the trigger path can", async () => {
      const { part, offer } = await sourcingPart();
      expect(await as(U1, () => fails("select public.refresh_part_sourcing($1)", [part]))).toMatch(/not allowed/);
      expect(await as(ADMIN, () => fails("select public.refresh_part_sourcing($1)", [part]))).toBeNull();
      expect(await as("service", () => fails("select public.refresh_part_sourcing($1)", [part]))).toBeNull();
      await as(ADMIN, () => db.query("update public.supplier_offers set cost = 2 where id = $1", [offer]));
      const r = await one<{ landed_cost_qar: string; preferred_offer_id: string }>("select landed_cost_qar, preferred_offer_id from public.parts where id = $1", [part]);
      expect(r.preferred_offer_id).toBe(offer);
      expect(Number(r.landed_cost_qar)).toBe(8.01); // 2 USD × 3.64 × 1.10
    });

    it("DB-19: offer_landed_cost_qar is denied to anon and clients, open to admins", async () => {
      const { offer } = await sourcingPart();
      expect(await as(null, () => fails("select public.offer_landed_cost_qar($1)", [offer]))).toMatch(/permission denied/);
      expect(await as(U1, () => fails("select public.offer_landed_cost_qar($1)", [offer]))).toMatch(/not allowed/);
      expect(Number((await as(ADMIN, () => one<{ c: string }>("select public.offer_landed_cost_qar($1) as c", [offer]))).c)).toBe(4);
    });

    it("DB-22: class helpers denied to anon, still open to sessions", async () => {
      for (const fn of ["class_teacher_of_project", "is_class_project", "is_class_teacher_of_project"]) {
        expect(await as(null, () => fails(`select public.${fn}(gen_random_uuid())`))).toMatch(/permission denied/);
        expect(await as(U1, () => fails(`select public.${fn}(gen_random_uuid())`))).toBeNull();
      }
    });

    it("DB-22: anon SELECT on projects returns no rows (no error); the teacher still reads the team project", async () => {
      expect(await as(null, () => rows("select id from public.projects"))).toEqual([]);
      const p = await classProjectWithToken();
      expect(await as(TEACHER, () => rows("select id from public.projects where id = $1", [p]))).toEqual([{ id: p }]);
      // Without the 0103 'to authenticated' the same anon read fails outright (the regression).
      await db.exec("alter policy projects_select_class_teacher on public.projects to public");
      expect(await as(null, () => fails("select id from public.projects"))).toMatch(/permission denied for function is_class_teacher_of_project/);
      await db.exec("alter policy projects_select_class_teacher on public.projects to authenticated");
    });

    it("API-02: at most 3 recovery emails per address per day, whichever session asks", async () => {
      expect(await recoveryEmails("victim2@x.qa", [ADMIN, ADMIN, TEACHER, U2])).toEqual(["ok", "ok", "ok", "rate_limited"]);
      expect(await recoveryEmails("other@x.qa", [U2])).toEqual(["ok"]);
    });
  });
});
