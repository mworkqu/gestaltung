-- ============================================================================
-- Gestaltung — 0053: order status history, status emails, one-tap rating and
--                    the credit earned-date rule (P2-01 / P2-02, 2026-10-09)
-- ============================================================================
-- Run AFTER 0052 (it replaces 0052's spend_credit). Safe to re-run.
--
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   -- 1. statuses in use today (old set: pending, confirmed, processing,
--   --    shipped, delivered, cancelled)
--   select status, count(*) from public.part_orders group by 1 order by 1;
--   -- 2. spend rows whose redemption window will SHRINK (owner rule: 30 days
--   --    from the day the credit was EARNED, not from the spend). Unredeemed
--   --    rows only; redeemed rows keep their history.
--   select count(*) filter (where redeemable_until > now()) as redeemable_now,
--          count(*) as unredeemed_spends
--     from public.credits_ledger
--    where reason like 'spend:%' and redeemed_order_id is null;
--   -- 3. kinds already in the outbox (the check constraint is replaced)
--   select kind, count(*) from public.notification_outbox group by 1;
--
-- ROLLBACK (manual, one transaction; the status mapping is NOT undone — the
-- old set has no 'paid'/'sourcing', map them back by hand if you must):
--   drop trigger  if exists part_orders_status_history on public.part_orders;
--   drop trigger  if exists part_orders_notify_status  on public.part_orders;
--   drop function if exists public.part_orders_status_history();
--   drop function if exists public.part_orders_notify_status();
--   drop function if exists public.order_notification_enqueue(uuid, text, text);
--   drop function if exists public.set_order_status(uuid, text, text);
--   drop function if exists public.order_status_transition_ok(text, text);
--   drop function if exists public.record_order_rating(uuid, integer);
--   drop function if exists public.credit_next_earned_at(uuid, text);
--   drop table    if exists public.order_status_history;
--   then re-run 0052 (spend_credit) and 0046's notify_credits_ledger body.
--
-- WHAT CHANGES
-- 1. Order statuses. Target chain: confirmed → paid → sourcing → shipped →
--    delivered, plus cancelled. Mapping of the old set (0011):
--      pending    → confirmed   (placed, we confirm on WhatsApp)
--      processing → sourcing    (we are buying / making it)
--      confirmed, shipped, delivered, cancelled → unchanged
--    (There never was a 'new', 'ready' or 'out_for_delivery' value: the 0011
--    check constraint only allowed the six above.) part_orders.status default
--    becomes 'confirmed'. create_part_order (0044 v6) is NOT touched: it never
--    names a status, so new orders take the default.
--
-- 2. order_status_history — one row per status an order reached: written by
--    a trigger on INSERT (the first status) and on every UPDATE that changes
--    status (whoever does it: the RPC below, the old admin action, the Table
--    Editor). The note comes from set_order_status (transaction-local setting
--    app.order_status_note). Existing orders get ONE back-filled row (their
--    current status, dated updated_at — created_at for 'confirmed').
--    RLS: the order's owner reads (part_orders.profile_id = auth.uid(); a
--    guest's anonymous session is an authenticated user with its own uid, so
--    guests who placed an order read it too); super admin reads and writes all.
--    Customers SEE the note (timeline + status email).
--
-- 3. set_order_status(p_order, p_status, p_note) — SECURITY DEFINER, super
--    admin only. Allowed: any status → cancelled; otherwise forward only along
--    the chain (skipping steps is allowed, e.g. confirmed → sourcing for cash
--    on delivery); delivered and cancelled are terminal; the same status again
--    is refused ('same_status'). The 0042 trigger part_orders_grant_credits
--    (+3 wiring +1 cad, once per order, unique index) still fires on the
--    UPDATE to 'delivered'. Direct UPDATEs are not validated (Table Editor
--    stays an escape hatch) but still write history and emails.
--
-- 4. Status emails through the 0046 outbox. New kinds order_confirmed,
--    order_paid, order_sourcing, order_shipped, order_delivered,
--    order_cancelled (check constraint replaced; the same names are in
--    OUTBOX_KINDS — lib/notifications/decide.ts — and NOTIFICATION_KINDS —
--    lib/email/templates/index.ts). Trigger part_orders_notify_status: AFTER
--    UPDATE OF status, when it changed → kind 'order_' || new status.
--    Not on INSERT: /api/orders/confirmation already emails the customer the
--    moment the order is placed (so order_confirmed only goes out if an order
--    is ever moved INTO 'confirmed' by an update). Dedupe = the 0046 unique
--    index (user_id, kind, payload->>'ref'), ref = order id: one email per
--    order per status. Email = the order's customer_email (the address given
--    at checkout, guests included), else the account's confirmed email.
--    An order with no profile_id (very old guest orders) queues nothing: the
--    outbox needs a user. These are transactional: the drainer ignores the
--    per-kind opt-out for them and sends no unsubscribe link (the unsubscribe
--    page already says order emails are not affected).
--    store_settings.notifications gains the six keys (true, owner edits kept).
--
-- 5. Credit earned-date rule (owner: a spent credit is redeemable as QAR 20
--    for 30 days from the day the credit was EARNED). credits_ledger gains
--    earned_at (spend rows). spend_credit (0052 body otherwise unchanged)
--    takes the earn date FIFO: the user's earn rows (delta > 0: purchase:,
--    admin_grant, topup:) of that kind in created_at order, expanded per unit;
--    the units already used = −sum of the negative rows (spends and negative
--    admin corrections); the spend consumes the next unit. redeemable_until =
--    earned_at + 30 days (may already be past: then the spend is simply not
--    redeemable). Existing spend rows are back-filled the same way; unredeemed
--    ones get redeemable_until = least(old, earned_at + 30 days); redeemed
--    rows keep their old window. redeem_credits needs no change (it filters
--    on redeemable_until > now(), earliest first).
--    notify_credits_ledger: discount_ready now only when redeemable_until is
--    still in the future, and payload earned_at = the earn date.
--    store_settings.notifications.discount_ready → true.
--
-- 6. Rating: demand_signals.kind allows 'rating' (score in quantity, note =
--    'order:<id>', one row per order — a second tap changes the score).
--    record_order_rating(p_order, p_score) — service_role only, delivered
--    orders only; called by GET /api/orders/rate after the HMAC check.
-- ============================================================================

begin;

-- ─── 1. Order history table (created first so the back-fill can use it) ────
create table if not exists public.order_status_history (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.part_orders (id) on delete cascade,
  status      text not null,
  note        text,
  changed_by  uuid references auth.users (id) on delete set null,
  changed_at  timestamptz not null default now()
);

do $$ begin
  alter table public.order_status_history add constraint order_status_history_status_check
    check (status in ('confirmed', 'paid', 'sourcing', 'shipped', 'delivered', 'cancelled'));
exception when duplicate_object then null; end $$;

create index if not exists order_status_history_order_idx
  on public.order_status_history (order_id, changed_at);

alter table public.order_status_history enable row level security;

revoke all on public.order_status_history from anon, authenticated;
grant select, insert, update, delete on public.order_status_history to authenticated;

drop policy if exists order_status_history_own_select on public.order_status_history;
create policy order_status_history_own_select on public.order_status_history
  for select to authenticated
  using (
    public.is_super_admin()
    or exists (
      select 1 from public.part_orders po
       where po.id = order_id
         and po.profile_id = auth.uid()
    )
  );

drop policy if exists order_status_history_admin_all on public.order_status_history;
create policy order_status_history_admin_all on public.order_status_history
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ─── 2. Status set: back-fill history, map old values, new check ───────────
-- Triggers created by an earlier run of this file stay quiet during the
-- mapping (transaction-local switch).
select set_config('app.order_status_backfill', 'on', true);

-- One row per existing order that has none, at its (mapped) current status.
insert into public.order_status_history (order_id, status, note, changed_by, changed_at)
select o.id,
       case o.status when 'pending' then 'confirmed' when 'processing' then 'sourcing' else o.status end,
       null,
       null,
       case when o.status in ('pending', 'confirmed') then o.created_at else coalesce(o.updated_at, o.created_at) end
  from public.part_orders o
 where not exists (select 1 from public.order_status_history h where h.order_id = o.id)
   and o.status in ('pending', 'confirmed', 'processing', 'paid', 'sourcing', 'shipped', 'delivered', 'cancelled');

alter table public.part_orders drop constraint if exists part_orders_status_check;

update public.part_orders set status = 'confirmed' where status = 'pending';
update public.part_orders set status = 'sourcing'  where status = 'processing';

alter table public.part_orders add constraint part_orders_status_check
  check (status in ('confirmed', 'paid', 'sourcing', 'shipped', 'delivered', 'cancelled'));
alter table public.part_orders alter column status set default 'confirmed';

select set_config('app.order_status_backfill', '', true);

-- ─── 3. Transition rule + admin RPC ─────────────────────────────────────────
create or replace function public.order_status_transition_ok(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_from is null or p_to is null then false
    when p_from = p_to then false
    when p_from in ('delivered', 'cancelled') then false
    when p_to = 'cancelled' then true
    else coalesce(array_position(array['confirmed', 'paid', 'sourcing', 'shipped', 'delivered'], p_to), 0)
       > coalesce(array_position(array['confirmed', 'paid', 'sourcing', 'shipped', 'delivered'], p_from), 99)
  end;
$$;

revoke all on function public.order_status_transition_ok(text, text) from public;
grant execute on function public.order_status_transition_ok(text, text) to anon, authenticated;

-- Returns {from, to}. Raises: not allowed / bad_status / not_found /
-- same_status / bad_transition.
create or replace function public.set_order_status(p_order uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from text;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  if p_status is null or p_status not in ('confirmed', 'paid', 'sourcing', 'shipped', 'delivered', 'cancelled') then
    raise exception 'bad_status';
  end if;

  select status into v_from from public.part_orders where id = p_order for update;
  if not found then raise exception 'not_found'; end if;
  if v_from = p_status then raise exception 'same_status'; end if;
  if not public.order_status_transition_ok(v_from, p_status) then
    raise exception 'bad_transition' using detail = v_from || ' -> ' || p_status;
  end if;

  perform set_config('app.order_status_note', coalesce(left(btrim(p_note), 1000), ''), true);
  update public.part_orders set status = p_status where id = p_order;
  perform set_config('app.order_status_note', '', true);

  return jsonb_build_object('from', v_from, 'to', p_status);
end $$;

revoke all on function public.set_order_status(uuid, text, text) from public, anon;
grant execute on function public.set_order_status(uuid, text, text) to authenticated;

-- ─── 4. History trigger (INSERT and status UPDATE) ──────────────────────────
create or replace function public.part_orders_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  if coalesce(current_setting('app.order_status_backfill', true), '') = 'on' then return null; end if;
  begin
    insert into public.order_status_history (order_id, status, note, changed_by)
    values (new.id, new.status,
            nullif(btrim(coalesce(current_setting('app.order_status_note', true), '')), ''),
            auth.uid());
  exception when others then
    -- History must never block checkout or a status change.
    raise warning 'part_orders_status_history skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.part_orders_status_history() from public, anon, authenticated;

drop trigger if exists part_orders_status_history on public.part_orders;
create trigger part_orders_status_history
  after insert or update of status on public.part_orders
  for each row execute function public.part_orders_status_history();

-- ─── 5. Outbox: kinds, enqueue, trigger ─────────────────────────────────────
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('credits_order_delivered', 'credits_admin_grant', 'first_project', 'first_circuit', 'discount_ready',
                  'order_confirmed', 'order_paid', 'order_sourcing', 'order_shipped', 'order_delivered', 'order_cancelled'));

-- Owner switches: add the six order kinds (true) without touching existing
-- values, and switch discount_ready on now that the earned-date rule exists.
insert into public.store_settings (key, value)
values ('notifications', '{}'::jsonb)
on conflict (key) do nothing;

update public.store_settings
   set value = '{"order_confirmed": true, "order_paid": true, "order_sourcing": true, "order_shipped": true, "order_delivered": true, "order_cancelled": true}'::jsonb
               || coalesce(value, '{}'::jsonb)
               || '{"discount_ready": true}'::jsonb
 where key = 'notifications';

-- Queues one order email. Transactional: no opt-out check. Returns the outbox
-- id, or null (no user on the order / already queued for this status).
create or replace function public.order_notification_enqueue(p_order uuid, p_kind text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o      record;
  v_email  text;
  v_locale text;
  v_status text := 'queued';
  v_error  text;
  v_id     uuid;
begin
  select id, profile_id, customer_email, total_qar, payment_method, created_at
    into v_o from public.part_orders where id = p_order;
  if not found or v_o.profile_id is null then return null; end if;

  select case when p.locale = 'ar' then 'ar' else 'en' end,
         case when u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false)
              then nullif(btrim(coalesce(p.email, u.email)), '') end
    into v_locale, v_email
    from auth.users u
    left join public.profiles p on p.id = u.id
   where u.id = v_o.profile_id;
  if not found then return null; end if;

  v_email := coalesce(nullif(btrim(coalesce(v_o.customer_email, '')), ''), v_email);
  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    v_status := 'skipped'; v_error := 'no_email';
  end if;

  insert into public.notification_outbox (user_id, kind, payload, locale, email, status, last_error)
  values (v_o.profile_id, p_kind, jsonb_build_object(
            'ref', v_o.id::text,
            'order_id', v_o.id::text,
            'order_short', left(v_o.id::text, 8),
            'status', substring(p_kind from 7),
            'note', nullif(btrim(coalesce(p_note, '')), ''),
            'total_qar', v_o.total_qar,
            'payment_method', v_o.payment_method),
          coalesce(v_locale, 'en'), v_email, v_status, v_error)
  on conflict (user_id, kind, (payload ->> 'ref')) do nothing
  returning id into v_id;
  return v_id;
end $$;

revoke all on function public.order_notification_enqueue(uuid, text, text) from public, anon, authenticated;

create or replace function public.part_orders_notify_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then return null; end if;
  if coalesce(current_setting('app.order_status_backfill', true), '') = 'on' then return null; end if;
  begin
    perform public.order_notification_enqueue(
      new.id,
      'order_' || new.status,
      nullif(btrim(coalesce(current_setting('app.order_status_note', true), '')), ''));
  exception when others then
    raise warning 'part_orders_notify_status skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.part_orders_notify_status() from public, anon, authenticated;

drop trigger if exists part_orders_notify_status on public.part_orders;
create trigger part_orders_notify_status
  after update of status on public.part_orders
  for each row execute function public.part_orders_notify_status();

-- ─── 6. Credits: earned date (FIFO) ─────────────────────────────────────────
alter table public.credits_ledger add column if not exists earned_at timestamptz;

-- The earn date of the NEXT unit this user would spend of this kind: earn
-- rows (delta > 0) in created_at order, one unit per credit; units already
-- used = −sum(delta < 0). Null when nothing is left (the caller falls back).
create or replace function public.credit_next_earned_at(p_user uuid, p_kind text)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  with used as (
    select coalesce(-sum(delta), 0) as n
      from public.credits_ledger
     where user_id = p_user and kind = p_kind and delta < 0
  ), earns as (
    select created_at, sum(delta) over (order by created_at, id) as cum
      from public.credits_ledger
     where user_id = p_user and kind = p_kind and delta > 0
  )
  select e.created_at
    from earns e, used u
   where e.cum > u.n
   order by e.cum
   limit 1;
$$;

revoke all on function public.credit_next_earned_at(uuid, text) from public, anon, authenticated;

-- 0052's spend_credit with one change: the spend row carries earned_at and
-- redeemable_until = earned_at + 30 days.
create or replace function public.spend_credit(p_step text, p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_role   text := public.ai_role();
  v_p      record;
  v_bal    integer;
  v_earned timestamptz;
begin
  if p_step not in ('wiring', 'cad') then raise exception 'bad_step'; end if;
  if v_role = 'anonymous' then raise exception 'sign_in'; end if;
  if v_role = 'admin' then
    return jsonb_build_object('charged', false, 'cost', 'none', 'balance', null);
  end if;

  -- Lock the project so two parallel calls cannot both use one cad regen.
  select id, free_wiring_used, cad_regens_remaining into v_p
    from public.projects where id = p_project and user_id = v_uid
     for update;
  if not found then raise exception 'not_found'; end if;

  perform set_config('app.credits_write', 'on', true);

  if p_step = 'cad' and v_p.cad_regens_remaining > 0 then
    update public.projects set cad_regens_remaining = cad_regens_remaining - 1 where id = p_project;
    return jsonb_build_object('charged', false, 'cost', 'included', 'balance', public.credit_balance_of(v_uid, 'cad'),
                              'regens', v_p.cad_regens_remaining - 1);
  end if;

  perform pg_advisory_xact_lock(hashtext('credits:' || v_uid::text));
  v_bal := public.credit_balance_of(v_uid, p_step);
  if v_bal < 1 then raise exception 'no_credits'; end if;

  v_earned := coalesce(public.credit_next_earned_at(v_uid, p_step), now());

  insert into public.credits_ledger (user_id, kind, delta, reason, redeemable_until, earned_at, created_by)
  values (v_uid, p_step, -1, 'spend:' || p_project::text, v_earned + interval '30 days', v_earned, v_uid);

  if p_step = 'cad' then
    update public.projects set cad_regens_remaining = 2 where id = p_project;
  elsif not v_p.free_wiring_used then
    -- Marker only (no longer a free circuit): fires the 0046 first_circuit email.
    update public.projects set free_wiring_used = true where id = p_project;
  end if;

  return jsonb_build_object('charged', true, 'cost', 'credit', 'balance', v_bal - 1);
end $$;

revoke all on function public.spend_credit(text, uuid) from public, anon;
grant execute on function public.spend_credit(text, uuid) to authenticated;

-- Back-fill existing spend rows (replay FIFO as of each spend).
do $$
declare
  r        record;
  v_earned timestamptz;
begin
  for r in
    select id, user_id, kind, created_at
      from public.credits_ledger
     where reason like 'spend:%' and earned_at is null
     order by created_at, id
  loop
    with used as (
      select coalesce(-sum(delta), 0) as n
        from public.credits_ledger
       where user_id = r.user_id and kind = r.kind and delta < 0
         and (created_at, id) < (r.created_at, r.id)
    ), earns as (
      select created_at, sum(delta) over (order by created_at, id) as cum
        from public.credits_ledger
       where user_id = r.user_id and kind = r.kind and delta > 0 and created_at <= r.created_at
    )
    select e.created_at into v_earned
      from earns e, used u
     where e.cum > u.n
     order by e.cum
     limit 1;

    update public.credits_ledger
       set earned_at = coalesce(v_earned, r.created_at),
           redeemable_until = case
             when redeemed_order_id is null
               then least(coalesce(redeemable_until, 'infinity'::timestamptz),
                          coalesce(v_earned, r.created_at) + interval '30 days')
             else redeemable_until end
     where id = r.id;
  end loop;
end $$;

-- 0046's ledger trigger: discount_ready only while the window is open, dated
-- from the earn date.
create or replace function public.notify_credits_ledger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   text;
  v_wiring  integer;
  v_cad     integer;
begin
  begin
    if new.reason like 'purchase:%' and new.delta > 0 then
      v_order := substring(new.reason from 10);
      select coalesce(sum(delta) filter (where kind = 'wiring'), 0)::integer,
             coalesce(sum(delta) filter (where kind = 'cad'), 0)::integer
        into v_wiring, v_cad
        from public.credits_ledger
       where user_id = new.user_id and reason = new.reason;
      perform public.notification_enqueue(new.user_id, 'credits_order_delivered', jsonb_build_object(
        'ref', v_order,
        'order_short', left(v_order, 8),
        'circuit_credits', v_wiring,
        'cad_credits', v_cad));

    elsif new.reason = 'admin_grant' and new.delta > 0 then
      perform public.notification_enqueue(new.user_id, 'credits_admin_grant', jsonb_build_object(
        'ref', new.id::text,
        'amount', new.delta,
        'credit_kind', new.kind,
        'note', new.note));

    elsif new.reason like 'spend:%' and new.redeemable_until is not null and new.redeemable_until > now() then
      perform public.notification_enqueue(new.user_id, 'discount_ready', jsonb_build_object(
        'ref', new.id::text,
        'amount_qar', 20,
        'valid_until', to_char(new.redeemable_until at time zone 'Asia/Qatar', 'YYYY-MM-DD'),
        'earned_at', to_char(coalesce(new.earned_at, new.created_at) at time zone 'Asia/Qatar', 'YYYY-MM-DD'),
        'project_id', substring(new.reason from 7)));
    end if;
  exception when others then
    raise warning 'notify_credits_ledger skipped: %', sqlerrm;
  end;
  return null;
end $$;

revoke all on function public.notify_credits_ledger() from public, anon, authenticated;

-- ─── 7. Rating (one tap from the delivered email) ───────────────────────────
-- 0029 declared the check inline (auto-named, normally demand_signals_kind_check):
-- drop whichever check constraint limits kind, then add the named one.
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.demand_signals'::regclass
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%bom_unmatched%'
  loop
    execute format('alter table public.demand_signals drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.demand_signals add constraint demand_signals_kind_check
  check (kind in ('view', 'add_to_cart', 'request', 'zero_search', 'bom_unmatched', 'rating'));

create unique index if not exists demand_signals_rating_once
  on public.demand_signals (note) where kind = 'rating';

create or replace function public.record_order_rating(p_order uuid, p_score integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_status text;
begin
  if p_score is null or p_score < 1 or p_score > 5 then raise exception 'bad_score'; end if;
  select profile_id, status into v_user, v_status from public.part_orders where id = p_order;
  if not found or v_status <> 'delivered' then return false; end if;

  insert into public.demand_signals (kind, user_id, quantity, note, source_page)
  values ('rating', v_user, p_score, 'order:' || p_order::text, 'email:order_delivered')
  on conflict (note) where kind = 'rating'
  do update set quantity = excluded.quantity, created_at = now();
  return true;
end $$;

revoke all on function public.record_order_rating(uuid, integer) from public, anon, authenticated;
grant execute on function public.record_order_rating(uuid, integer) to service_role;

do $$ begin raise notice '0053 applied: order statuses (pending→confirmed, processing→sourcing; + paid), order_status_history + triggers, set_order_status, order_* outbox kinds, credits earned_at (FIFO) + discount_ready on, rating signals'; end $$;

commit;
