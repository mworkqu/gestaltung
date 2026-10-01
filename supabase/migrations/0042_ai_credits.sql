-- ============================================================================
-- Gestaltung — 0042: AI access, usage counting and credits (2026-10-01)
-- ============================================================================
-- Who may use which AI step, how use is counted, and how credits work.
-- No payment here: credits come from completed store orders and admin grants.
--
-- Roles for AI (ai_role()):
--   admin     = profiles.role 'super_admin'
--   user      = signed in with a CONFIRMED email (not an anonymous session)
--   anonymous = no session, a guest's anonymous session, or unconfirmed email
--
-- Steps:
--   bom     anonymous + user allowed, rate-limited per day (bom_rate_check);
--           admin unlimited
--   wiring  anonymous blocked; user: first circuit per project free, every
--           further one costs 1 wiring credit; admin unlimited
--   cad     anonymous blocked; user: 1 cad credit = a session of up to 3
--           generations on one project (cad_regens_remaining); admin unlimited
--
-- Credits: credits_ledger, balance = sum(delta) per (user, kind) — never a
-- balance column. Every spend row is redeemable as a QAR 20 discount on a
-- later order for 30 days (redeem_credits). Never a cash refund.
--
-- The client can READ its own ledger rows but never write them: every ledger
-- write goes through the SECURITY DEFINER functions below, which re-check the
-- rules. A trigger stops clients editing the project credit columns directly.
--
-- Also: projects.status ('active'|'archived') with a 3-active-projects limit
-- enforced by trigger (super_admin exempt), profiles.email kept in sync for
-- admin search, ai_usage.step/anon_key/cost_usd + the ai_usage_log view.
--
-- Run after 0041. Safe to re-run.
-- ============================================================================

-- ─── profiles.email (admin user search) ─────────────────────────────────────
alter table public.profiles add column if not exists email text;

update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id and p.email is distinct from u.email;

create index if not exists profiles_email_idx on public.profiles (lower(email));

create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('app.profile_sync', 'on', true);
  update public.profiles set email = new.email where id = new.id and email is distinct from new.email;
  return new;
end $$;

-- Named to sort after on_auth_user_created, so the profile row exists.
drop trigger if exists on_auth_user_email_sync on auth.users;
create trigger on_auth_user_email_sync
  after insert or update of email on auth.users
  for each row execute function public.sync_profile_email();

-- A user cannot rewrite their own profiles.email (admin search trusts it).
create or replace function public.profiles_guard_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email
     and coalesce(current_setting('app.profile_sync', true), '') <> 'on'
     and auth.uid() is not null
     and not public.is_super_admin() then
    new.email := old.email;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_email on public.profiles;
create trigger profiles_guard_email
  before update on public.profiles
  for each row execute function public.profiles_guard_email();

-- ─── Role for AI ────────────────────────────────────────────────────────────
create or replace function public.ai_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return 'anonymous'; end if;
  if public.is_super_admin() then return 'admin'; end if;
  if exists (
    select 1 from auth.users u
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
       and not coalesce(u.is_anonymous, false)
  ) then return 'user'; end if;
  return 'anonymous';
end $$;

revoke all on function public.ai_role() from public;
grant execute on function public.ai_role() to anon, authenticated;

-- ─── Projects: status, credit columns, limit ────────────────────────────────
alter table public.projects
  add column if not exists status text not null default 'active',
  add column if not exists free_wiring_used boolean not null default false,
  add column if not exists cad_tier text,
  add column if not exists cad_regens_remaining integer not null default 0;

do $$ begin
  alter table public.projects add constraint projects_status_check check (status in ('active', 'archived'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.projects add constraint projects_cad_tier_check check (cad_tier is null or cad_tier in ('simple', 'standard', 'complex'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.projects add constraint projects_cad_regens_check check (cad_regens_remaining >= 0);
exception when duplicate_object then null; end $$;

create index if not exists projects_user_status_idx on public.projects (user_id, status);

-- Clients may update their own projects (name, brief, status …) but never the
-- credit columns; only the functions below (which set app.credits_write) can.
create or replace function public.projects_guard_credit_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.credits_write', true), '') <> 'on'
     and auth.uid() is not null
     and not public.is_super_admin() then
    new.free_wiring_used := old.free_wiring_used;
    new.cad_regens_remaining := old.cad_regens_remaining;
    new.cad_tier := old.cad_tier;
  end if;
  return new;
end $$;

drop trigger if exists projects_guard_credit_columns on public.projects;
create trigger projects_guard_credit_columns
  before update on public.projects
  for each row execute function public.projects_guard_credit_columns();

-- New rows start clean whatever the client sends.
create or replace function public.projects_insert_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_super_admin() then
    new.free_wiring_used := false;
    new.cad_regens_remaining := 0;
    new.cad_tier := null;
  end if;
  return new;
end $$;

drop trigger if exists projects_insert_defaults on public.projects;
create trigger projects_insert_defaults
  before insert on public.projects
  for each row execute function public.projects_insert_defaults();

-- At most 3 ACTIVE projects per owner; archiving frees a slot. The owner's
-- role decides (super_admin unlimited), not the caller's. Existing owners
-- already over the limit keep their projects; they just cannot add more.
create or replace function public.projects_enforce_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.status <> 'active' or new.user_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.user_id is not distinct from new.user_id then
    return new;
  end if;
  if exists (select 1 from public.profiles where id = new.user_id and role = 'super_admin') then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('projects_limit:' || new.user_id::text));
  select count(*) into v_count
    from public.projects
   where user_id = new.user_id and status = 'active' and id <> new.id;
  if v_count >= 3 then
    raise exception 'project_limit' using hint = 'Archive a project to create another (3 active projects at a time).';
  end if;
  return new;
end $$;

drop trigger if exists projects_enforce_limit on public.projects;
create trigger projects_enforce_limit
  before insert or update of status, user_id on public.projects
  for each row execute function public.projects_enforce_limit();

-- ─── credits_ledger ─────────────────────────────────────────────────────────
create table if not exists public.credits_ledger (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  kind              text not null check (kind in ('wiring', 'cad')),
  delta             integer not null,
  -- 'purchase:<order_id>' | 'admin_grant' | 'topup:<payment_id>'
  -- | 'spend:<project_id>' | 'redeemed:<order_id>'
  reason            text not null,
  note              text,
  redeemable_until  timestamptz,          -- set on 'spend:' rows only
  redeemed_order_id uuid references public.part_orders (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index if not exists credits_ledger_user_idx on public.credits_ledger (user_id, kind);
create index if not exists credits_ledger_redeemable_idx
  on public.credits_ledger (user_id, redeemable_until)
  where reason like 'spend:%' and redeemed_order_id is null;
-- One grant per order and kind, however often the order is marked delivered.
create unique index if not exists credits_ledger_purchase_once
  on public.credits_ledger (user_id, kind, reason)
  where reason like 'purchase:%';

alter table public.credits_ledger enable row level security;

revoke insert, update, delete on public.credits_ledger from anon, authenticated;
grant select on public.credits_ledger to authenticated;

drop policy if exists credits_ledger_select on public.credits_ledger;
create policy credits_ledger_select on public.credits_ledger
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

create or replace function public.credit_balance_of(p_user uuid, p_kind text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(delta), 0)::integer from public.credits_ledger where user_id = p_user and kind = p_kind;
$$;

revoke all on function public.credit_balance_of(uuid, text) from public, anon, authenticated;

-- ─── Orders: credit discount column ─────────────────────────────────────────
alter table public.part_orders
  add column if not exists credit_discount_qar numeric(10, 2) not null default 0;

-- ─── Summary for the signed-in caller ───────────────────────────────────────
create or replace function public.credit_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  text := public.ai_role();
  v_n     integer := 0;
  v_next  timestamptz;
  v_act   integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('role', v_role, 'wiring', 0, 'cad', 0, 'redeemable_count', 0, 'redeemable_qar', 0,
                              'next_expiry', null, 'active_projects', 0, 'project_limit', 3, 'credit_qar', 20);
  end if;

  select count(*), min(redeemable_until) into v_n, v_next
    from public.credits_ledger
   where user_id = v_uid and reason like 'spend:%' and redeemed_order_id is null and redeemable_until > now();

  select count(*) into v_act from public.projects where user_id = v_uid and status = 'active';

  return jsonb_build_object(
    'role', v_role,
    'wiring', public.credit_balance_of(v_uid, 'wiring'),
    'cad', public.credit_balance_of(v_uid, 'cad'),
    'redeemable_count', v_n,
    'redeemable_qar', v_n * 20,
    'next_expiry', v_next,
    'active_projects', v_act,
    'project_limit', case when v_role = 'admin' then null else 3 end,
    'credit_qar', 20
  );
end $$;

revoke all on function public.credit_summary() from public;
grant execute on function public.credit_summary() to anon, authenticated;

-- ─── can_use: may the caller run this step on this project right now? ───────
-- Returns {allowed, reason, cost, role, balance, regens}
--   reason: null | 'sign_in' | 'no_credits' | 'not_found' | 'bad_step'
--   cost:   'none' (bom/admin) | 'free' (first wiring) | 'credit' | 'included' (cad regen)
create or replace function public.credit_can_use(p_step text, p_project uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.ai_role();
  v_p    record;
  v_bal  integer;
begin
  if p_step not in ('bom', 'wiring', 'cad') then
    return jsonb_build_object('allowed', false, 'reason', 'bad_step', 'cost', null, 'role', v_role);
  end if;
  if p_step = 'bom' then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'none', 'role', v_role);
  end if;
  if v_role = 'anonymous' then
    return jsonb_build_object('allowed', false, 'reason', 'sign_in', 'cost', null, 'role', v_role);
  end if;
  if v_role = 'admin' then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'none', 'role', v_role);
  end if;

  select id, free_wiring_used, cad_regens_remaining into v_p
    from public.projects where id = p_project and user_id = v_uid;
  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'not_found', 'cost', null, 'role', v_role);
  end if;

  v_bal := public.credit_balance_of(v_uid, p_step);

  if p_step = 'wiring' then
    if not v_p.free_wiring_used then
      return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'free', 'role', v_role, 'balance', v_bal);
    end if;
  else
    if v_p.cad_regens_remaining > 0 then
      return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'included', 'role', v_role,
                                'balance', v_bal, 'regens', v_p.cad_regens_remaining);
    end if;
  end if;

  if v_bal >= 1 then
    return jsonb_build_object('allowed', true, 'reason', null, 'cost', 'credit', 'role', v_role, 'balance', v_bal);
  end if;
  return jsonb_build_object('allowed', false, 'reason', 'no_credits', 'cost', 'credit', 'role', v_role, 'balance', v_bal);
end $$;

revoke all on function public.credit_can_use(text, uuid) from public;
grant execute on function public.credit_can_use(text, uuid) to anon, authenticated;

-- ─── spend: called AFTER a successful result ────────────────────────────────
-- wiring: first per project flips free_wiring_used; later ones write a
--         'spend:' row (-1 wiring), redeemable for 30 days.
-- cad:    uses an included regeneration if any; otherwise spends 1 cad credit
--         and opens a session of 3 generations (this one + 2 more).
-- admin:  never charged, nothing written.
-- Returns {charged, cost, balance}. Raises sign_in / not_found / no_credits.
create or replace function public.spend_credit(p_step text, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.ai_role();
  v_p    record;
  v_bal  integer;
begin
  if p_step not in ('wiring', 'cad') then raise exception 'bad_step'; end if;
  if v_role = 'anonymous' then raise exception 'sign_in'; end if;
  if v_role = 'admin' then
    return jsonb_build_object('charged', false, 'cost', 'none', 'balance', null);
  end if;

  -- Lock the project so two parallel calls cannot both use the free one.
  select id, free_wiring_used, cad_regens_remaining into v_p
    from public.projects where id = p_project and user_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;

  perform set_config('app.credits_write', 'on', true);

  if p_step = 'wiring' and not v_p.free_wiring_used then
    update public.projects set free_wiring_used = true where id = p_project;
    return jsonb_build_object('charged', false, 'cost', 'free', 'balance', public.credit_balance_of(v_uid, 'wiring'));
  end if;

  if p_step = 'cad' and v_p.cad_regens_remaining > 0 then
    update public.projects set cad_regens_remaining = cad_regens_remaining - 1 where id = p_project;
    return jsonb_build_object('charged', false, 'cost', 'included', 'balance', public.credit_balance_of(v_uid, 'cad'),
                              'regens', v_p.cad_regens_remaining - 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v_uid::text));
  v_bal := public.credit_balance_of(v_uid, p_step);
  if v_bal < 1 then raise exception 'no_credits'; end if;

  insert into public.credits_ledger (user_id, kind, delta, reason, redeemable_until, created_by)
  values (v_uid, p_step, -1, 'spend:' || p_project::text, now() + interval '30 days', v_uid);

  if p_step = 'cad' then
    update public.projects set cad_regens_remaining = 2 where id = p_project;
  end if;

  return jsonb_build_object('charged', true, 'cost', 'credit', 'balance', v_bal - 1);
end $$;

revoke all on function public.spend_credit(text, uuid) from public, anon;
grant execute on function public.spend_credit(text, uuid) to authenticated;

-- ─── CAD request: store the tier (the stub stage — no spend) ────────────────
create or replace function public.set_cad_request(p_project uuid, p_tier text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tier not in ('simple', 'standard', 'complex') then raise exception 'bad_tier'; end if;
  if public.ai_role() = 'anonymous' then raise exception 'sign_in'; end if;
  perform set_config('app.credits_write', 'on', true);
  update public.projects set cad_tier = p_tier
   where id = p_project and (user_id = auth.uid() or public.is_super_admin());
  if not found then raise exception 'not_found'; end if;
end $$;

revoke all on function public.set_cad_request(uuid, text) from public, anon;
grant execute on function public.set_cad_request(uuid, text) to authenticated;

-- ─── Grants ─────────────────────────────────────────────────────────────────
-- Completed store order (status 'delivered'), any amount: +3 wiring, +1 cad
-- to the account that placed it. Once per order (unique index).
create or replace function public.grant_credits_for_order_internal(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_n    integer;
begin
  select profile_id into v_user from public.part_orders where id = p_order;
  if v_user is null then return false; end if;
  insert into public.credits_ledger (user_id, kind, delta, reason, note)
  values (v_user, 'wiring', 3, 'purchase:' || p_order::text, 'Completed store order'),
         (v_user, 'cad',    1, 'purchase:' || p_order::text, 'Completed store order')
  on conflict (user_id, kind, reason) where reason like 'purchase:%' do nothing;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

revoke all on function public.grant_credits_for_order_internal(uuid) from public, anon, authenticated;

-- Admin re-run / manual trigger for one order. Idempotent.
create or replace function public.grant_for_order(p_order uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.part_orders where id = p_order and status = 'delivered') then
    raise exception 'order_not_completed';
  end if;
  return public.grant_credits_for_order_internal(p_order);
end $$;

revoke all on function public.grant_for_order(uuid) from public, anon;
grant execute on function public.grant_for_order(uuid) to authenticated;

create or replace function public.part_orders_grant_credits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' then
    perform public.grant_credits_for_order_internal(new.id);
  end if;
  return new;
end $$;

drop trigger if exists part_orders_grant_credits on public.part_orders;
create trigger part_orders_grant_credits
  after update of status on public.part_orders
  for each row execute function public.part_orders_grant_credits();

-- Manual grant (bank transfer / WhatsApp top-ups until online payment exists).
-- A negative amount corrects a mistake. A note is required.
create or replace function public.admin_grant(p_user uuid, p_kind text, p_amount integer, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_kind not in ('wiring', 'cad') then raise exception 'bad_kind'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000 then raise exception 'bad_amount'; end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then raise exception 'note_required'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'no_user'; end if;
  if p_amount < 0 and public.credit_balance_of(p_user, p_kind) + p_amount < 0 then
    raise exception 'below_zero';
  end if;
  insert into public.credits_ledger (user_id, kind, delta, reason, note, created_by)
  values (p_user, p_kind, p_amount, 'admin_grant', btrim(p_note), auth.uid())
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.admin_grant(uuid, text, integer, text) from public, anon;
grant execute on function public.admin_grant(uuid, text, integer, text) to authenticated;

-- ─── Redemption at checkout ─────────────────────────────────────────────────
-- Called right after create_part_order, by the person who placed the order
-- (within an hour), or by an admin. Applies every unredeemed, unexpired spend
-- as ONE discount (QAR 20 each), capped at the order's goods subtotal (after
-- the kit discount, before shipping and handling). Spends are used oldest-
-- expiry first; a spend only partly needed to reach the cap is used up too.
-- Returns the QAR applied. Runs once per order.
create or replace function public.redeem_credits(p_order uuid)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o       record;
  v_avail   integer;
  v_goods   numeric(10, 2);
  v_applied numeric(10, 2);
  v_n       integer;
  v_kind    text;
begin
  select id, profile_id, created_at, status, total_qar, shipping_qar, handling_fee_qar, credit_discount_qar
    into v_o from public.part_orders where id = p_order for update;
  if not found then raise exception 'not_found'; end if;
  if not public.is_super_admin() then
    if v_o.profile_id is distinct from auth.uid() then raise exception 'not allowed'; end if;
    if v_o.created_at < now() - interval '1 hour' then raise exception 'too_late'; end if;
  end if;
  if v_o.profile_id is null or v_o.status = 'cancelled' or v_o.credit_discount_qar > 0 then return 0; end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v_o.profile_id::text));

  select count(*) into v_avail
    from public.credits_ledger
   where user_id = v_o.profile_id and reason like 'spend:%' and redeemed_order_id is null and redeemable_until > now();
  if v_avail = 0 then return 0; end if;

  v_goods := greatest(v_o.total_qar - coalesce(v_o.shipping_qar, 0) - coalesce(v_o.handling_fee_qar, 0), 0);
  v_applied := least(v_avail * 20, v_goods);
  if v_applied <= 0 then return 0; end if;
  v_n := ceil(v_applied / 20)::integer;

  with picked as (
    select id, kind from public.credits_ledger
     where user_id = v_o.profile_id and reason like 'spend:%' and redeemed_order_id is null and redeemable_until > now()
     order by redeemable_until, created_at
     limit v_n
     for update
  )
  update public.credits_ledger l set redeemed_order_id = p_order
    from picked where l.id = picked.id;

  select kind into v_kind from public.credits_ledger where redeemed_order_id = p_order order by created_at limit 1;

  -- Audit row: changes no balance (delta 0).
  insert into public.credits_ledger (user_id, kind, delta, reason, note, created_by)
  values (v_o.profile_id, coalesce(v_kind, 'wiring'), 0, 'redeemed:' || p_order::text,
          format('QAR %s applied from %s spent credit(s)', v_applied, v_n), auth.uid());

  update public.part_orders
     set total_qar = total_qar - v_applied, credit_discount_qar = v_applied
   where id = p_order;

  return v_applied;
end $$;

revoke all on function public.redeem_credits(uuid) from public, anon;
grant execute on function public.redeem_credits(uuid) to authenticated;

-- ─── Rate limit for the BOM step ────────────────────────────────────────────
-- Day = Qatar calendar day. Anonymous: 5 per day per anonymous session AND per
-- hashed IP (the server hashes the IP with a secret salt before calling).
-- Signed-in users: 30 per day. Admin: unlimited. Overridable in
-- store_settings.ai_limits = {"bom_anon_per_day": 5, "bom_user_per_day": 30}.
-- TODO(turnstile): add Cloudflare Turnstile for anonymous BOM before this
-- limit is the only thing between a bot and the provider quota.
create table if not exists public.ai_rate_limits (
  key  text not null,
  day  date not null,
  hits integer not null default 0,
  primary key (key, day)
);

alter table public.ai_rate_limits enable row level security;
revoke all on public.ai_rate_limits from anon, authenticated;

create or replace function public.bom_rate_check(p_ip_hash text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  text := public.ai_role();
  v_day   date := (now() at time zone 'Asia/Qatar')::date;
  v_set   jsonb;
  v_limit integer;
  v_keys  text[] := '{}';
  v_k     text;
  v_hits  integer;
  v_max   integer := 0;
begin
  if v_role = 'admin' then
    return jsonb_build_object('allowed', true, 'used', 0, 'limit', null, 'role', v_role);
  end if;
  select value into v_set from public.store_settings where key = 'ai_limits';
  v_limit := case when v_role = 'user'
                  then coalesce((v_set ->> 'bom_user_per_day')::integer, 30)
                  else coalesce((v_set ->> 'bom_anon_per_day')::integer, 5) end;

  if auth.uid() is not null then v_keys := v_keys || ('u:' || auth.uid()::text); end if;
  if v_role = 'anonymous' and nullif(p_ip_hash, '') is not null then
    v_keys := v_keys || ('ip:' || left(p_ip_hash, 128));
  end if;
  if cardinality(v_keys) = 0 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', v_limit, 'role', v_role);
  end if;

  foreach v_k in array v_keys loop
    select hits into v_hits from public.ai_rate_limits where key = v_k and day = v_day;
    v_max := greatest(v_max, coalesce(v_hits, 0));
  end loop;
  if v_max >= v_limit then
    return jsonb_build_object('allowed', false, 'used', v_max, 'limit', v_limit, 'role', v_role);
  end if;

  foreach v_k in array v_keys loop
    insert into public.ai_rate_limits (key, day, hits) values (v_k, v_day, 1)
    on conflict (key, day) do update set hits = public.ai_rate_limits.hits + 1;
  end loop;
  delete from public.ai_rate_limits where day < v_day - 7;

  return jsonb_build_object('allowed', true, 'used', v_max + 1, 'limit', v_limit, 'role', v_role);
end $$;

revoke all on function public.bom_rate_check(text) from public;
grant execute on function public.bom_rate_check(text) to anon, authenticated;

-- ─── ai_usage: step, anon_key, cost; the ai_usage_log view ──────────────────
alter table public.ai_usage
  add column if not exists anon_key text,
  add column if not exists cost_usd numeric(12, 6);

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('analyse', 'netlist', 'transcribe', 'electronics', 'firmware', 'cad'));

create or replace function public.ai_usage_fill_anon_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.anon_key is null and new.user_id is not null and exists (
    select 1 from auth.users u where u.id = new.user_id and coalesce(u.is_anonymous, false)
  ) then
    new.anon_key := 'anon:' || new.user_id::text;
  end if;
  return new;
end $$;

drop trigger if exists ai_usage_fill_anon_key on public.ai_usage;
create trigger ai_usage_fill_anon_key
  before insert on public.ai_usage
  for each row execute function public.ai_usage_fill_anon_key();

-- The spec's ai_usage_log shape over the existing ai_usage table.
create or replace view public.ai_usage_log
with (security_invoker = on) as
select id,
       user_id,
       anon_key,
       case feature
         when 'analyse' then 'bom'
         when 'electronics' then 'bom'
         when 'netlist' then 'wiring'
         else feature
       end as step,
       project_id,
       prompt_tokens     as tokens_in,
       completion_tokens as tokens_out,
       cost_usd,
       outcome,
       is_test,
       created_at
  from public.ai_usage;

grant select on public.ai_usage_log to authenticated;

-- Calls per day per step (admin).
create or replace function public.ai_usage_daily(p_days integer default 14)
returns table (day date, step text, calls bigint, ok_calls bigint, tokens_in bigint, tokens_out bigint, cost_usd numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return query
    select (l.created_at at time zone 'Asia/Qatar')::date as day,
           l.step,
           count(*) as calls,
           count(*) filter (where l.outcome = 'ok') as ok_calls,
           coalesce(sum(l.tokens_in), 0)::bigint,
           coalesce(sum(l.tokens_out), 0)::bigint,
           sum(l.cost_usd)
      from public.ai_usage_log l
     where l.created_at >= now() - make_interval(days => greatest(1, least(p_days, 90)))
       and not coalesce(l.is_test, false)
     group by 1, 2
     order by 1 desc, 2;
end $$;

revoke all on function public.ai_usage_daily(integer) from public, anon;
grant execute on function public.ai_usage_daily(integer) to authenticated;

-- Admin user search with balances.
create or replace function public.admin_credit_users(p_query text default null)
returns table (id uuid, email text, full_name text, role text, wiring integer, cad integer, last_entry timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return query
    select p.id, p.email, p.full_name, p.role,
           public.credit_balance_of(p.id, 'wiring'),
           public.credit_balance_of(p.id, 'cad'),
           (select max(l.created_at) from public.credits_ledger l where l.user_id = p.id)
      from public.profiles p
     where p.email is not null
       and (v_q is null
            or p.email ilike '%' || v_q || '%'
            or p.full_name ilike '%' || v_q || '%'
            or p.id::text = v_q)
     order by (select max(l.created_at) from public.credits_ledger l where l.user_id = p.id) desc nulls last, p.email
     limit 50;
end $$;

revoke all on function public.admin_credit_users(text) from public, anon;
grant execute on function public.admin_credit_users(text) to authenticated;

do $$ begin raise notice '0042 applied: credits_ledger, project status + 3-active limit, rate limits, credit RPCs, ai_usage_log'; end $$;
