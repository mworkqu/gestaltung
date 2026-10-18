-- Gestaltung — 0089: token packs, the optional Maker Pass, auto-verified Fawran payments
-- (owner, 2026-10-18). Run after 0088.
--
-- Pay-per-use stays the default. Amounts come from lib/billing/config.ts:
--   * token packs  → kind 'idea' tokens that never expire ('topup:<payment>');
--   * Maker Pass   → 30 days + the monthly grant as kind 'idea_pass'
--                    ('pass:<payment>'), capped so the pass balance never goes
--                    above the rollover cap (unused tokens roll over one month);
--                    pass tokens lapse when the pass ends ('pass_expired').
--   * spending     → pass tokens first, then bought/welcome tokens.
--
-- payments: one row per purchase. The user uploads a Fawran screenshot to the
-- private 'payment-proofs' bucket; the server (service role) hashes it, reads it
-- with a vision model and settles the row: 'approved' (auto_approved = true,
-- granted at once) or 'needs_review' with the reasons. Admins approve / reject
-- / revoke from /dashboard/payments; auto-approved rows stay listed there for
-- spot checks. Users can only read their own rows: every write goes through the
-- service-role functions below (amounts are never taken from the browser) or the
-- admin functions (is_super_admin()).
--
-- Rollback:
--   drop function if exists public.admin_payment_review(uuid, text, text), public.admin_pass_expire(uuid, text),
--     public.admin_revenue_users(), public.payment_create(uuid, text, text, numeric, integer, integer, integer, boolean),
--     public.payment_attach_proof(uuid, text, text), public.payment_settle(uuid, text, boolean, jsonb, text[], text),
--     public.payment_apply_internal(uuid), public.payment_unapply_internal(uuid), public.idea_pass_sweep(uuid);
--   drop table if exists public.idea_passes, public.payments;
--   (then re-run 0088 for idea_token_status / idea_token_charge, and restore the kind / feature checks)

-- ─── Kinds ──────────────────────────────────────────────────────────────────
alter table public.credits_ledger drop constraint if exists credits_ledger_kind_check;
alter table public.credits_ledger add constraint credits_ledger_kind_check
  check (kind in ('wiring', 'cad', 'idea', 'idea_pass'));

alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
alter table public.ai_usage add constraint ai_usage_feature_check
  check (feature in ('analyse', 'netlist', 'transcribe', 'electronics', 'firmware', 'cad', 'studio', 'billing'));

-- ─── payments ───────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  kind            text not null check (kind in ('tokens', 'pass', 'service')),
  product         text not null,
  amount_qar      numeric(10, 2) not null check (amount_qar > 0),
  tokens          integer not null default 0 check (tokens >= 0),
  days            integer,
  cap             integer,
  method          text not null default 'fawran' check (method in ('fawran')),
  -- What the user writes in the transfer note, e.g. GT-7K3M9Q.
  reference_code  text not null unique,
  status          text not null default 'awaiting_proof'
                    check (status in ('awaiting_proof', 'verifying', 'approved', 'needs_review', 'rejected', 'revoked', 'cancelled')),
  auto_approved   boolean not null default false,
  proof_path      text,
  proof_hash      text,
  transfer_ref    text,
  verdict         jsonb,
  review_reasons  text[],
  note            text,
  reviewed_by     uuid references auth.users (id) on delete set null,
  reviewed_at     timestamptz,
  approved_at     timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists payments_user_idx on public.payments (user_id, created_at desc);
create index if not exists payments_status_idx on public.payments (status, created_at desc);
create index if not exists payments_hash_idx on public.payments (proof_hash) where proof_hash is not null;
create index if not exists payments_ref_idx on public.payments (lower(transfer_ref)) where transfer_ref is not null;

alter table public.payments enable row level security;
revoke insert, update, delete on public.payments from anon, authenticated;
grant select on public.payments to authenticated;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- ─── idea_passes ────────────────────────────────────────────────────────────
create table if not exists public.idea_passes (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  active_until     timestamptz not null,
  started_at       timestamptz not null default now(),
  last_payment_id  uuid references public.payments (id) on delete set null,
  updated_at       timestamptz not null default now()
);

alter table public.idea_passes enable row level security;
revoke insert, update, delete on public.idea_passes from anon, authenticated;
grant select on public.idea_passes to authenticated;

drop policy if exists idea_passes_select on public.idea_passes;
create policy idea_passes_select on public.idea_passes
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- ─── Proof screenshots: private bucket, own folder ──────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 8388608, array['image/png', 'image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/png', 'image/jpeg'];

drop policy if exists payment_proofs_insert on storage.objects;
create policy payment_proofs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists payment_proofs_read on storage.objects;
create policy payment_proofs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin()));

-- ─── Pass expiry (lazy) ─────────────────────────────────────────────────────
-- A lapsed pass: its remaining tokens go ('pass_expired'). Runs on every status / charge.
create or replace function public.idea_pass_sweep(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bal integer;
begin
  if p_user is null then return; end if;
  if exists (select 1 from public.idea_passes where user_id = p_user and active_until > now()) then return; end if;
  v_bal := public.credit_balance_of(p_user, 'idea_pass');
  if v_bal > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (p_user, 'idea_pass', -v_bal, 'pass_expired', 'Maker Pass ended');
  end if;
end $$;

revoke all on function public.idea_pass_sweep(uuid) from public, anon, authenticated;

-- ─── Grant / take back one payment ──────────────────────────────────────────
create or replace function public.payment_apply_internal(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p     public.payments;
  v_bal integer;
  v_add integer;
begin
  select * into p from public.payments where id = p_payment for update;
  if p.kind = 'tokens' and p.tokens > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (p.user_id, 'idea', p.tokens, 'topup:' || p.id::text, p.product);
  elsif p.kind = 'pass' then
    perform public.idea_pass_sweep(p.user_id);
    insert into public.idea_passes as s (user_id, active_until, last_payment_id)
    values (p.user_id, now() + make_interval(days => coalesce(p.days, 30)), p.id)
    on conflict (user_id) do update
      set active_until = greatest(s.active_until, now()) + make_interval(days => coalesce(p.days, 30)),
          last_payment_id = p.id,
          started_at = case when s.active_until < now() then now() else s.started_at end,
          updated_at = now();
    v_bal := public.credit_balance_of(p.user_id, 'idea_pass');
    v_add := least(p.tokens, greatest(coalesce(p.cap, p.tokens * 2) - v_bal, 0));
    if v_add > 0 then
      insert into public.credits_ledger (user_id, kind, delta, reason, note)
      values (p.user_id, 'idea_pass', v_add, 'pass:' || p.id::text, 'Maker Pass month');
    end if;
  end if;
end $$;

revoke all on function public.payment_apply_internal(uuid) from public, anon, authenticated;

-- Revoke: take back what is still there (never below zero) and end the pass.
create or replace function public.payment_unapply_internal(p_payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.payments;
  v_take integer;
begin
  select * into p from public.payments where id = p_payment for update;
  if p.kind = 'tokens' then
    v_take := least(p.tokens, greatest(public.credit_balance_of(p.user_id, 'idea'), 0));
    if v_take > 0 then
      insert into public.credits_ledger (user_id, kind, delta, reason, note)
      values (p.user_id, 'idea', -v_take, 'revoke:' || p.id::text, 'Payment revoked');
    end if;
  elsif p.kind = 'pass' then
    update public.idea_passes set active_until = now(), updated_at = now() where user_id = p.user_id;
    perform public.idea_pass_sweep(p.user_id);
  end if;
end $$;

revoke all on function public.payment_unapply_internal(uuid) from public, anon, authenticated;

-- ─── Service-role API (the server routes) ───────────────────────────────────
create or replace function public.payment_create(
  p_user uuid, p_kind text, p_product text, p_amount numeric, p_tokens integer, p_days integer, p_cap integer, p_is_test boolean default false
) returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_row  public.payments;
  v_abc  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  -- An older unpaid row for the same product is replaced (one open checkout per product).
  update public.payments set status = 'cancelled', updated_at = now()
   where user_id = p_user and product = p_product and status = 'awaiting_proof';
  loop
    v_code := 'GT-' || (select string_agg(substr(v_abc, 1 + floor(random() * length(v_abc))::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.payments where reference_code = v_code);
  end loop;
  insert into public.payments (user_id, kind, product, amount_qar, tokens, days, cap, reference_code, is_test)
  values (p_user, p_kind, p_product, p_amount, greatest(coalesce(p_tokens, 0), 0), p_days, p_cap, v_code, coalesce(p_is_test, false))
  returning * into v_row;
  return v_row;
end $$;

revoke all on function public.payment_create(uuid, text, text, numeric, integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.payment_create(uuid, text, text, numeric, integer, integer, integer, boolean) to service_role;

create or replace function public.payment_attach_proof(p_payment uuid, p_path text, p_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
     set proof_path = p_path, proof_hash = p_hash, status = 'verifying', updated_at = now()
   where id = p_payment and status in ('awaiting_proof', 'needs_review');
  if not found then raise exception 'not_open'; end if;
end $$;

revoke all on function public.payment_attach_proof(uuid, text, text) from public, anon, authenticated;
grant execute on function public.payment_attach_proof(uuid, text, text) to service_role;

-- 'approved' grants at once; a reused proof image or transfer reference is never
-- auto-approved (→ needs_review 'duplicate'), whatever the caller decided.
create or replace function public.payment_settle(
  p_payment uuid, p_status text, p_auto boolean, p_verdict jsonb, p_reasons text[], p_transfer_ref text
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p        public.payments;
  v_status text := p_status;
  v_reasons text[] := coalesce(p_reasons, '{}');
begin
  select * into p from public.payments where id = p_payment for update;
  if p.id is null then raise exception 'not_found'; end if;
  if p.status <> 'verifying' then raise exception 'not_verifying'; end if;
  if v_status not in ('approved', 'needs_review') then raise exception 'bad_status'; end if;

  if v_status = 'approved' and (
       exists (select 1 from public.payments o where o.id <> p.id and o.proof_hash = p.proof_hash
                 and o.status in ('approved', 'verifying', 'needs_review', 'revoked'))
    or (nullif(btrim(p_transfer_ref), '') is not null and exists (
          select 1 from public.payments o where o.id <> p.id and lower(o.transfer_ref) = lower(btrim(p_transfer_ref))
            and o.status in ('approved', 'needs_review', 'revoked')))
  ) then
    v_status := 'needs_review';
    v_reasons := array_append(v_reasons, 'duplicate');
  end if;

  update public.payments
     set status = v_status,
         auto_approved = (v_status = 'approved' and coalesce(p_auto, false)),
         verdict = p_verdict,
         review_reasons = v_reasons,
         transfer_ref = nullif(btrim(p_transfer_ref), ''),
         approved_at = case when v_status = 'approved' then now() end,
         updated_at = now()
   where id = p.id;
  if v_status = 'approved' then perform public.payment_apply_internal(p.id); end if;
  return v_status;
end $$;

revoke all on function public.payment_settle(uuid, text, boolean, jsonb, text[], text) from public, anon, authenticated;
grant execute on function public.payment_settle(uuid, text, boolean, jsonb, text[], text) to service_role;

-- ─── Admin ──────────────────────────────────────────────────────────────────
-- approve: a needs_review / verifying / rejected row → granted. reject: not granted.
-- revoke: an approved row (auto or manual) → what is left is taken back.
create or replace function public.admin_payment_review(p_payment uuid, p_action text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select * into p from public.payments where id = p_payment for update;
  if p.id is null then raise exception 'not_found'; end if;
  if p_action = 'approve' and p.status in ('verifying', 'needs_review', 'rejected', 'awaiting_proof') then
    update public.payments set status = 'approved', auto_approved = false, approved_at = now(),
           reviewed_by = auth.uid(), reviewed_at = now(), note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p.id;
    perform public.payment_apply_internal(p.id);
  elsif p_action = 'reject' and p.status in ('verifying', 'needs_review', 'awaiting_proof') then
    update public.payments set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p.id;
  elsif p_action = 'revoke' and p.status = 'approved' then
    update public.payments set status = 'revoked', reviewed_by = auth.uid(), reviewed_at = now(),
           note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now()
     where id = p.id;
    perform public.payment_unapply_internal(p.id);
  elsif p_action = 'check' and p.status = 'approved' then
    -- Spot-check of an auto-approved proof: keep it, record who looked.
    update public.payments set reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now() where id = p.id;
  else
    raise exception 'bad_action';
  end if;
  select status into p.status from public.payments where id = p.id;
  return p.status;
end $$;

revoke all on function public.admin_payment_review(uuid, text, text) from public, anon;
grant execute on function public.admin_payment_review(uuid, text, text) to authenticated;

create or replace function public.admin_pass_expire(p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  update public.idea_passes set active_until = now(), updated_at = now() where user_id = p_user;
  perform public.idea_pass_sweep(p_user);
end $$;

revoke all on function public.admin_pass_expire(uuid, text) from public, anon;
grant execute on function public.admin_pass_expire(uuid, text) to authenticated;

-- Revenue per user next to AI cost (/dashboard/ai-costs). Test rows left out.
create or replace function public.admin_revenue_users()
returns table (user_id uuid, revenue_qar numeric, payments bigint, pass_until timestamptz, pass_balance integer, idea_balance integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  return query
    select u.uid,
           coalesce((select sum(p.amount_qar) from public.payments p where p.user_id = u.uid and p.status = 'approved' and not p.is_test), 0),
           (select count(*) from public.payments p where p.user_id = u.uid and p.status = 'approved' and not p.is_test),
           (select ip.active_until from public.idea_passes ip where ip.user_id = u.uid),
           public.credit_balance_of(u.uid, 'idea_pass'),
           public.credit_balance_of(u.uid, 'idea')
      from (select distinct x.user_id as uid from (
              select p.user_id from public.payments p
              union select ip.user_id from public.idea_passes ip
              union select l.user_id from public.credits_ledger l where l.kind in ('idea', 'idea_pass')
            ) x) u;
end $$;

revoke all on function public.admin_revenue_users() from public, anon;
grant execute on function public.admin_revenue_users() to authenticated;

-- ─── 0088's token functions, now pass-aware ─────────────────────────────────
create or replace function public.idea_token_status(p_project uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_role text := public.ai_role();
  v_s    public.idea_sessions;
  v_pass timestamptz;
  v_pb   integer;
  v_bb   integer;
begin
  if v_uid is null then
    return jsonb_build_object('role', 'anonymous', 'balance', 0, 'pass_balance', 0, 'bought_balance', 0, 'pass_until', null,
                              'started', false, 'edit_turns', 0, 'tokens_used', 0, 'tier', 'explorer');
  end if;

  insert into public.credits_ledger (user_id, kind, delta, reason, note)
  values (v_uid, 'idea', public.idea_welcome_tokens(), 'idea_welcome', 'Welcome ideation tokens')
  on conflict do nothing;
  perform public.idea_pass_sweep(v_uid);

  if p_project is not null and public.owns_project(p_project) then
    select * into v_s from public.idea_sessions where project_id = p_project;
  end if;
  select active_until into v_pass from public.idea_passes where user_id = v_uid and active_until > now();
  v_pb := public.credit_balance_of(v_uid, 'idea_pass');
  v_bb := public.credit_balance_of(v_uid, 'idea');

  return jsonb_build_object(
    'role', v_role,
    'balance', v_pb + v_bb,
    'pass_balance', v_pb,
    'bought_balance', v_bb,
    'pass_until', v_pass,
    'started', v_s.project_id is not null,
    'edit_turns', coalesce(v_s.edit_turns, 0),
    'tokens_used', coalesce(v_s.tokens_used, 0),
    'tier', coalesce(v_s.tier, 'explorer')
  );
end $$;

revoke all on function public.idea_token_status(uuid) from public;
grant execute on function public.idea_token_status(uuid) to authenticated;

create or replace function public.idea_token_charge(p_project uuid, p_amount integer, p_tier text, p_edit boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_amount  integer := greatest(0, least(coalesce(p_amount, 0), 20));
  v_tier    text := case when p_tier in ('explorer', 'maker', 'engineer') then p_tier else 'explorer' end;
  v_pb      integer;
  v_bb      integer;
  v_from_pass integer;
  v_s       public.idea_sessions;
  v_reason  text;
  v_note    text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'sign_in', 'balance', 0); end if;
  if p_project is null or not public.owns_project(p_project) then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'balance', 0);
  end if;
  if public.is_super_admin() then v_amount := 0; end if;

  perform pg_advisory_xact_lock(hashtext('idea:' || v_uid::text));

  insert into public.credits_ledger (user_id, kind, delta, reason, note)
  values (v_uid, 'idea', public.idea_welcome_tokens(), 'idea_welcome', 'Welcome ideation tokens')
  on conflict do nothing;
  perform public.idea_pass_sweep(v_uid);

  v_pb := greatest(public.credit_balance_of(v_uid, 'idea_pass'), 0);
  v_bb := greatest(public.credit_balance_of(v_uid, 'idea'), 0);
  if v_amount > v_pb + v_bb then
    return jsonb_build_object('ok', false, 'error', 'no_tokens', 'balance', v_pb + v_bb);
  end if;

  -- Pass tokens first, then bought / welcome tokens.
  v_from_pass := least(v_amount, v_pb);
  v_reason := 'idea:' || p_project::text;
  v_note := case when p_edit then 'Idea edits' else 'New idea' end;
  if v_from_pass > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note) values (v_uid, 'idea_pass', -v_from_pass, v_reason, v_note);
  end if;
  if v_amount - v_from_pass > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note) values (v_uid, 'idea', -(v_amount - v_from_pass), v_reason, v_note);
  end if;

  insert into public.idea_sessions as s (project_id, user_id, edit_turns, tokens_used, tier)
  values (p_project, v_uid, case when p_edit then 1 else 0 end, v_amount, v_tier)
  on conflict (project_id) do update
    set edit_turns  = s.edit_turns + case when p_edit then 1 else 0 end,
        tokens_used = s.tokens_used + v_amount,
        tier        = v_tier,
        updated_at  = now()
  returning * into v_s;

  return jsonb_build_object(
    'ok', true,
    'charged', v_amount,
    'balance', v_pb + v_bb - v_amount,
    'edit_turns', v_s.edit_turns,
    'tokens_used', v_s.tokens_used
  );
end $$;

revoke all on function public.idea_token_charge(uuid, integer, text, boolean) from public;
grant execute on function public.idea_token_charge(uuid, integer, text, boolean) to authenticated;

-- ─── 0088 admin_ai_cost_users: pass tokens count as used / balance too ─────
-- One row per (user, model). cost_usd sums logged costs; tokens_unpriced_in/out
-- are tokens on rows logged before 0088 (no cost) so the page can price them
-- with lib/ai/prices.ts. Idea-token figures repeat on each of a user's rows.
create or replace function public.admin_ai_cost_users(p_query text default null)
returns table (
  user_id uuid, email text, full_name text, is_anonymous boolean,
  model text, calls bigint, tokens_in bigint, tokens_out bigint, cost_usd numeric,
  tokens_unpriced_in bigint, tokens_unpriced_out bigint, last_call timestamptz,
  projects bigint, idea_used bigint, idea_balance integer
)
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
    with users as (
      select distinct x.uid from (
        select u.user_id as uid from public.ai_usage u where u.user_id is not null
        union
        select l.user_id from public.credits_ledger l where l.kind in ('idea', 'idea_pass') and l.reason like 'idea:%'
      ) x
    ),
    usage as (
      select u.user_id as uid, coalesce(u.model, '—') as model,
             count(*) filter (where u.outcome <> 'blocked') as calls,
             coalesce(sum(u.prompt_tokens), 0)::bigint as tin,
             coalesce(sum(u.completion_tokens), 0)::bigint as tout,
             coalesce(sum(u.cost_usd), 0) as cost,
             coalesce(sum(u.prompt_tokens) filter (where u.cost_usd is null), 0)::bigint as uin,
             coalesce(sum(u.completion_tokens) filter (where u.cost_usd is null), 0)::bigint as uout,
             max(u.created_at) as last_call
        from public.ai_usage u
       where u.user_id is not null
       group by 1, 2
    )
    select us.uid, coalesce(p.email, au.email), p.full_name, coalesce(au.is_anonymous, false),
           g.model, coalesce(g.calls, 0), coalesce(g.tin, 0), coalesce(g.tout, 0), coalesce(g.cost, 0),
           coalesce(g.uin, 0), coalesce(g.uout, 0), g.last_call,
           (select count(*) from public.projects pr where pr.user_id = us.uid),
           (select coalesce(-sum(l.delta), 0)::bigint from public.credits_ledger l
             where l.user_id = us.uid and l.kind in ('idea', 'idea_pass') and l.reason like 'idea:%'),
           public.credit_balance_of(us.uid, 'idea') + public.credit_balance_of(us.uid, 'idea_pass')
      from users us
      left join usage g on g.uid = us.uid
      left join public.profiles p on p.id = us.uid
      left join auth.users au on au.id = us.uid
     where v_q is null
        or coalesce(p.email, au.email) ilike '%' || v_q || '%'
        or p.full_name ilike '%' || v_q || '%'
        or us.uid::text = v_q
     order by g.last_call desc nulls last
     limit 2000;
end $$;

revoke all on function public.admin_ai_cost_users(text) from public, anon;
grant execute on function public.admin_ai_cost_users(text) to authenticated;

do $$ begin raise notice '0089 applied: payments (auto-verified Fawran), idea_passes (Maker Pass), pass-first token spending, payment-proofs bucket'; end $$;
