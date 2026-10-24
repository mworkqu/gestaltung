// Migration 0102 (audit DB-04 / DB-06 / G-C1): spend_credit and cad_set_code
// are no longer callable by a session; spend_credit_for / cad_set_code_for
// (service_role) act for the user the server names. Applied TWICE inside PGlite on top of the real
// 0096 (school classes, spend_credit v4) and the stub it needs. Never touches
// Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, migration, migrationFunction, pgliteDb } from "@/lib/db-test/pglite";

// The parts of 0001 / 0015 / 0042 that 0096 builds on (as in
// lib/schools/db/schools-migration.test.ts).
const STUB = `
${SUPABASE_BASE_STUB}
create function public.ai_role() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return 'anonymous'; end if;
  if public.is_super_admin() then return 'admin'; end if;
  if exists (select 1 from auth.users u where u.id = auth.uid()
              and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)) then return 'user'; end if;
  return 'anonymous';
end $$;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  spec jsonb,
  studio jsonb,
  studio_version integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  free_wiring_used boolean not null default false,
  cad_regens_remaining integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create policy projects_select on public.projects for select using (user_id = auth.uid() or public.is_super_admin());
create policy projects_insert on public.projects for insert with check (user_id = auth.uid());
create policy projects_update on public.projects for update
  using (user_id = auth.uid() or public.is_super_admin()) with check (user_id = auth.uid() or public.is_super_admin());

create table public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('wiring', 'cad')),
  delta integer not null,
  reason text,
  redeemable_until timestamptz,
  redeemed_order_id uuid,
  earned_at timestamptz,
  created_by uuid,
  note text,
  created_at timestamptz not null default now()
);
alter table public.credits_ledger enable row level security;
create policy credits_select on public.credits_ledger for select using (user_id = auth.uid() or public.is_super_admin());

create function public.credit_balance_of(p_user uuid, p_kind text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from public.credits_ledger where user_id = p_user and kind = p_kind;
$$;
create function public.credit_next_earned_at(p_user uuid, p_kind text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select min(earned_at) from public.credits_ledger where user_id = p_user and kind = p_kind and delta > 0;
$$;

create table public.store_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
alter table public.store_settings enable row level security;
create policy store_settings_select on public.store_settings for select using (true);
`;

// An internal SECURITY DEFINER caller, the way cad_deliver (0090) calls spend_credit.
const INTERNAL_CALLER = `
create or replace function public.test_cad_deliver(p_project uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  return public.spend_credit('cad', p_project);
end $$;
grant execute on function public.test_cad_deliver(uuid) to authenticated;
`;

// The 0043 CAD generation flow (cad_begin / cad_deliver as of 0090) on top of 0096.
const CAD = `
create table public.cad_generations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.cad_generations (id) on delete set null,
  request text not null,
  tier text not null,
  scad text,
  status text not null default 'pending',
  error text,
  charged boolean not null default false,
  model text,
  credit_cost integer not null default 1,
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);
alter table public.cad_generations enable row level security;
revoke all on public.cad_generations from anon, authenticated;
grant select on public.cad_generations to authenticated;
create policy cad_generations_select on public.cad_generations for select to authenticated using (user_id = auth.uid());
create function public.cad_tier_cost(p_tier text) returns integer language sql immutable set search_path = '' as $$
  select case p_tier when 'complex' then 3 when 'standard' then 2 else 1 end
$$;
${migrationFunction("0090_cad_cost_rewards.sql", "cad_begin")}
${migrationFunction("0043_cad_generations.sql", "cad_set_code")}
${migrationFunction("0090_cad_cost_rewards.sql", "cad_deliver")}
revoke all on function public.cad_begin(uuid, text, text, uuid) from public, anon;
grant execute on function public.cad_begin(uuid, text, text, uuid) to authenticated;
revoke all on function public.cad_set_code(uuid, text, text) from public, anon;
grant execute on function public.cad_set_code(uuid, text, text) to authenticated;
revoke all on function public.cad_deliver(uuid) from public, anon;
grant execute on function public.cad_deliver(uuid) to authenticated;
`;

const USER = "00000000-0000-4000-8000-000000000a01";
const OTHER = "00000000-0000-4000-8000-000000000a02";
const P1 = "00000000-0000-4000-8000-000000000b01";
const P2 = "00000000-0000-4000-8000-000000000b02";
const P3 = "00000000-0000-4000-8000-000000000b03";
const P4 = "00000000-0000-4000-8000-000000000b04";
const P5 = "00000000-0000-4000-8000-000000000b05";

const { db, rows, as, fails, applyTwice } = pgliteDb();

type Ledger = { user_id: string; kind: string; delta: number; reason: string; created_by: string; has_window: boolean; has_earned: boolean };
const ledger = (reason: string) =>
  rows<Ledger>(
    `select user_id, kind, delta, reason, created_by, redeemable_until is not null as has_window, earned_at is not null as has_earned
       from public.credits_ledger where reason = $1`,
    [reason],
  );

describe("0102_credits_server_spend", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec(migration("0096_school_classes.sql"));
    await db.exec(INTERNAL_CALLER);
    await db.exec(CAD);
    await db.exec(`
      insert into auth.users (id, email, email_confirmed_at) values ('${USER}', 'u@x.qa', now()), ('${OTHER}', 'o@x.qa', now());
      insert into public.profiles (id, role) values ('${USER}', 'client'), ('${OTHER}', 'client');
      insert into public.projects (id, user_id, name) values
        ('${P1}', '${USER}', 'a'), ('${P2}', '${USER}', 'b'), ('${P3}', '${USER}', 'c');
      -- Archived (the 3-active-project limit); the credit rules do not look at status.
      insert into public.projects (id, user_id, name, status) values ('${P4}', '${USER}', 'd', 'archived'), ('${P5}', '${USER}', 'e', 'archived');
      insert into public.credits_ledger (user_id, kind, delta, reason, earned_at) values
        ('${USER}', 'wiring', 5, 'purchase:x', now() - interval '1 day'),
        ('${USER}', 'cad', 5, 'purchase:x', now() - interval '1 day');
    `);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("BEFORE: a session calls spend_credit directly and mints a redeemable spend row (the hole)", async () => {
    const [r] = await as(USER, () => rows<{ s: { charged: boolean } }>("select public.spend_credit('wiring', $1) as s", [P1]));
    expect(r.s.charged).toBe(true);
    const [row] = await ledger(`spend:${P1}`);
    expect(row).toMatchObject({ user_id: USER, kind: "wiring", delta: -1, created_by: USER, has_window: true, has_earned: true });
  });

  it("BEFORE (G-C1): a session stores fake CAD code and cad_deliver mints a redeemable spend row", async () => {
    const [{ id }] = await as(USER, () => rows<{ id: string }>("select public.cad_begin($1, 'x', 'simple') as id", [P4]));
    await as(USER, () => rows("select public.cad_set_code($1, 'cube();', 'x')", [id]));
    const [r] = await as(USER, () => rows<{ s: { charged: boolean } }>("select public.cad_deliver($1) as s", [id]));
    expect(r.s.charged).toBe(true);
    expect(await ledger(`spend:${P4}`)).toHaveLength(1);
  });

  it("applies twice", async () => {
    await applyTwice("0102_credits_server_spend.sql");
  });

  it("AFTER: authenticated and anon spend_credit → permission denied; spend_credit_for is service-only", async () => {
    expect(await as(USER, () => fails("select public.spend_credit('wiring', $1)", [P2]))).toMatch(/permission denied/);
    expect(await as(null, () => fails("select public.spend_credit('wiring', $1)", [P2]))).toMatch(/permission denied/);
    expect(await as(USER, () => fails("select public.spend_credit_for($1, 'wiring', $2)", [USER, P2]))).toMatch(/permission denied/);
    expect(await ledger(`spend:${P2}`)).toHaveLength(0);
  });

  it("service spend_credit_for writes the same ledger row shape as spend_credit did", async () => {
    const [r] = await as("service", () =>
      rows<{ s: { charged: boolean; cost: string; balance: number } }>("select public.spend_credit_for($1, 'wiring', $2) as s", [USER, P2]),
    );
    expect(r.s).toEqual({ charged: true, cost: "credit", balance: 3 });
    const [before] = await ledger(`spend:${P1}`);
    const [after] = await ledger(`spend:${P2}`);
    expect({ ...after, reason: "x" }).toEqual({ ...before, reason: "x" });
    const [p] = await rows<{ free_wiring_used: boolean }>("select free_wiring_used from public.projects where id = $1", [P2]);
    expect(p.free_wiring_used).toBe(true);
    // wrong owner → not_found; unknown step → bad_step
    expect(await as("service", () => fails("select public.spend_credit_for($1, 'wiring', $2)", ["00000000-0000-4000-8000-000000000a09", P2]))).toMatch(/sign_in|not_found/);
    expect(await as("service", () => fails("select public.spend_credit_for($1, 'idea', $2)", [USER, P2]))).toMatch(/bad_step/);
  });

  it("AFTER (G-C1): cad_set_code is server-only; a session alone cannot create a spend: row", async () => {
    const [{ id }] = await as(USER, () => rows<{ id: string }>("select public.cad_begin($1, 'x', 'simple') as id", [P5]));
    expect(await as(USER, () => fails("select public.cad_set_code($1, 'cube();', 'x')", [id]))).toMatch(/permission denied/);
    expect(await as(null, () => fails("select public.cad_set_code($1, 'cube();', 'x')", [id]))).toMatch(/permission denied/);
    expect(await as(USER, () => fails("select public.cad_set_code_for($1, $2, 'cube();', 'x')", [USER, id]))).toMatch(/permission denied/);
    // No stored code → cad_deliver refuses and nothing is spent.
    expect(await as(USER, () => fails("select public.cad_deliver($1)", [id]))).toMatch(/not_ready/);
    expect(await ledger(`spend:${P5}`)).toHaveLength(0);
  });

  it("AFTER (G-C1): cad_begin + service cad_set_code_for + cad_deliver spends exactly once", async () => {
    const [{ id }] = await rows<{ id: string }>(
      "select id from public.cad_generations where project_id = $1 and status = 'pending'",
      [P5],
    );
    // The generation must belong to the user the server names.
    expect(await as("service", () => fails("select public.cad_set_code_for($1, $2, 'cube();', 'x')", [OTHER, id]))).toMatch(/not_found/);
    expect(await as("service", () => fails("select public.cad_set_code_for(null, $1, 'cube();', 'x')", [id]))).toMatch(/sign_in/);
    expect(await as("service", () => fails("select public.cad_set_code_for($1, $2, '  ', 'x')", [USER, id]))).toMatch(/bad_code/);
    await as("service", () => rows("select public.cad_set_code_for($1, $2, 'cube();', 'gemini')", [USER, id]));
    const [g] = await rows<{ scad: string; model: string }>("select scad, model from public.cad_generations where id = $1", [id]);
    expect(g).toEqual({ scad: "cube();", model: "gemini" });
    const [r] = await as(USER, () => rows<{ s: { charged: boolean } }>("select public.cad_deliver($1) as s", [id]));
    expect(r.s.charged).toBe(true);
    // Delivering again answers the same result without a second spend.
    await as(USER, () => rows("select public.cad_deliver($1)", [id]));
    expect(await ledger(`spend:${P5}`)).toHaveLength(1);
  });

  it("internal SECURITY DEFINER callers (cad_deliver) still spend as the caller", async () => {
    const [r] = await as(USER, () => rows<{ s: { charged: boolean } }>("select public.test_cad_deliver($1) as s", [P3]));
    expect(r.s.charged).toBe(true);
    const [row] = await ledger(`spend:${P3}`);
    expect(row).toMatchObject({ user_id: USER, kind: "cad", delta: -1, created_by: USER });
  });
});
