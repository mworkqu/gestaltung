-- ============================================================================
-- 0084_cc_payments.sql  -  CAD Champions: plans, checkout, payments, enrollment
-- ============================================================================
-- RUN AFTER 0083 (0083_cc_training_seed.sql). Needs the tables from
-- 0077_cc_core.sql (cc_plans, cc_coupons, cc_cohorts, cc_payments,
-- cc_enrollments, cc_audit_log, cc_journey_progress, cc_receipt_number_seq).
--
-- What it does (Prompt 10, docs/COMPETITION_ALIGNMENT.md P "Task 10")
--   1. Columns
--        cc_plans.kind              online | online_in_person | kit
--        cc_plans.price_qar         now NULLABLE: null = "Price coming soon"
--                                   (the UI shows that and blocks checkout)
--        cc_plans.duration_days     now NULLABLE (a kit has no duration)
--        cc_payments.addon_plan_id / addon_qar   optional measuring kit
--        cc_payments.proof_submitted_at, paid_at, terms_accepted_at,
--                    provider_status, status_changed_at
--        cc_payments reference_code format check (CAD-XXXX, no 0/O/1/I)
--        cc_enrollments.reminder_7d_sent_at / reminder_1d_sent_at
--   2. Cohorts readable by anyone (anon too; drafts stay staff-only).
--   3. cc_cohort_seats() now also counts HELD seats: an awaiting_transfer
--      payment before its expires_at (48 h) and a proof_submitted payment.
--   4. RPCs
--        cc_payment_transition_allowed(from, to, method) -> boolean (pure)
--        cc_validate_coupon(code, plan_id) -> jsonb       (authenticated)
--             returns the discount for the signed-in student WITHOUT
--             exposing cc_coupons (admin-only by RLS).
--        cc_create_payment(...) -> jsonb                  (service_role ONLY)
--             locks the cohort, checks seats, cancels the student's older
--             awaiting_transfer reservation, inserts the payment.
--        cc_payment_transition(payment, to, actor, reason, reason_ar, patch)
--             -> jsonb                                     (service_role ONLY)
--             the state machine (mirror of lib/cad-champions/payments/
--             state-machine.ts), row-locked so a payment can never be
--             approved twice; on paid: receipt number, enrollment (starts
--             now or when the current one ends, ends after duration_days),
--             journey enrolled_at, coupon use; on refunded: enrollment
--             cancelled; every transition writes cc_audit_log.
--   5. Seed (re-runnable, never overwrites prices/copy the owner edited):
--        plans "online" and "online-in-person" (price + days NULL =
--        [TODO-MO: price, days]) and the optional add-on "measuring-kit"
--        (kind kit, [TODO-MO: kit contents and price]).
--
-- Students can never write cc_payments / cc_enrollments (0077 RLS: select
-- own only); the two writing RPCs are executable by service_role only, so
-- payment status and enrollments cannot be forged by calling the API.
--
-- Safe to re-run: add column if not exists, guarded constraints, create or
-- replace, on conflict do nothing.
--
-- Rollback (comments):
--   drop function if exists public.cc_payment_transition(uuid, text, uuid, text, text, jsonb),
--     public.cc_create_payment(uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, text, timestamptz, timestamptz),
--     public.cc_validate_coupon(text, uuid), public.cc_payment_transition_allowed(text, text, text);
--   delete from public.cc_plans where slug in ('online', 'online-in-person', 'measuring-kit')
--     and not exists (select 1 from public.cc_payments p where p.plan_id = cc_plans.id);
--   alter table public.cc_payments drop column if exists addon_plan_id, drop column if exists addon_qar,
--     drop column if exists proof_submitted_at, drop column if exists paid_at,
--     drop column if exists terms_accepted_at, drop column if exists provider_status,
--     drop column if exists status_changed_at;
--   alter table public.cc_enrollments drop column if exists reminder_7d_sent_at, drop column if exists reminder_1d_sent_at;
--   alter table public.cc_plans drop column if exists kind;
--   (re-create cc_cohort_seats() from 0083 to stop counting held seats)
-- ============================================================================

-- ------------------------------------------------------------- 1. columns
alter table public.cc_plans add column if not exists kind text not null default 'online';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cc_plans_kind_check') then
    alter table public.cc_plans add constraint cc_plans_kind_check check (kind in ('online', 'online_in_person', 'kit'));
  end if;
end;
$$;
alter table public.cc_plans alter column price_qar drop not null;
alter table public.cc_plans alter column duration_days drop not null;

alter table public.cc_payments add column if not exists addon_plan_id uuid references public.cc_plans (id) on delete restrict;
alter table public.cc_payments add column if not exists addon_qar numeric(10, 2) not null default 0;
alter table public.cc_payments add column if not exists proof_submitted_at timestamptz;
alter table public.cc_payments add column if not exists paid_at timestamptz;
alter table public.cc_payments add column if not exists terms_accepted_at timestamptz;
alter table public.cc_payments add column if not exists provider_status text;
alter table public.cc_payments add column if not exists status_changed_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cc_payments_addon_qar_check') then
    alter table public.cc_payments add constraint cc_payments_addon_qar_check check (addon_qar >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cc_payments_reference_code_format') then
    alter table public.cc_payments add constraint cc_payments_reference_code_format
      check (reference_code ~ '^CAD-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4,8}$');
  end if;
end;
$$;

create index if not exists cc_payments_hold_idx on public.cc_payments (cohort_id, status)
  where status in ('awaiting_transfer', 'proof_submitted');
create index if not exists cc_payments_provider_idx on public.cc_payments (provider_payment_id)
  where provider_payment_id is not null;

alter table public.cc_enrollments add column if not exists reminder_7d_sent_at timestamptz;
alter table public.cc_enrollments add column if not exists reminder_1d_sent_at timestamptz;

-- ------------------------------------------- 2. cohorts readable by anyone
grant select on public.cc_cohorts to anon;
drop policy if exists cc_cohorts_read on public.cc_cohorts;
create policy cc_cohorts_read on public.cc_cohorts
  for select to anon, authenticated using (status <> 'draft' or public.cc_is_staff());

-- ------------------------------------------------- 3. seats incl. holds
create or replace function public.cc_cohort_seats()
returns table (cohort_id uuid, seats_taken integer)
language sql
stable
security definer
set search_path = ''
as $$
  select x.cohort_id, count(*)::integer
    from (
      select e.cohort_id
        from public.cc_enrollments e
       where e.cohort_id is not null and e.status = 'active' and e.ends_at > now()
      union all
      select p.cohort_id
        from public.cc_payments p
       where p.cohort_id is not null
         and ((p.status = 'awaiting_transfer' and (p.expires_at is null or p.expires_at > now()))
              or p.status = 'proof_submitted')
    ) x
   group by x.cohort_id;
$$;

revoke all on function public.cc_cohort_seats() from public;
grant execute on function public.cc_cohort_seats() to anon, authenticated, service_role;

-- ------------------------------------------------------------ 4. RPCs
-- The allowed transitions. MIRROR of lib/cad-champions/payments/state-machine.ts
-- (a test checks both lists match).
create or replace function public.cc_payment_transition_allowed(p_from text, p_to text, p_method text default 'fawran')
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (p_from || '>' || p_to) = any (array[
           'awaiting_transfer>proof_submitted',
           'awaiting_transfer>expired',
           'awaiting_transfer>cancelled',
           'proof_submitted>paid',
           'proof_submitted>rejected',
           'rejected>proof_submitted',
           'paid>refunded'
         ])
      or (p_method = 'skipcash' and (p_from || '>' || p_to) = any (array[
           'awaiting_transfer>paid'
         ]));
$$;

grant execute on function public.cc_payment_transition_allowed(text, text, text) to anon, authenticated, service_role;

-- Coupon check for the signed-in student. Same rules as
-- lib/cad-champions/payments/coupon.ts (checkCoupon + discountAmount).
create or replace function public.cc_validate_coupon(p_code text, p_plan uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c        public.cc_coupons;
  v_inst   text;
  v_price  numeric;
  v_disc   numeric;
begin
  -- Called with the student's session (the institution rule needs auth.uid()).
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  select * into c from public.cc_coupons where code = upper(btrim(coalesce(p_code, '')));
  if not found or not c.is_active then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if c.expires_at is not null and c.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if c.max_uses is not null and c.used_count >= c.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'used_up');
  end if;
  if c.plan_ids is not null and cardinality(c.plan_ids) > 0 and not (p_plan = any (c.plan_ids)) then
    return jsonb_build_object('ok', false, 'reason', 'wrong_plan');
  end if;
  if c.institution is not null and btrim(c.institution) <> '' then
    select pr.institution into v_inst from public.cc_profiles pr where pr.id = auth.uid();
    if lower(btrim(coalesce(v_inst, ''))) <> lower(btrim(c.institution)) then
      return jsonb_build_object('ok', false, 'reason', 'wrong_institution');
    end if;
  end if;
  select pl.price_qar into v_price from public.cc_plans pl where pl.id = p_plan and pl.is_active;
  if v_price is null then
    return jsonb_build_object('ok', false, 'reason', 'wrong_plan');
  end if;
  v_disc := case when c.discount_type = 'percent'
                 then round(v_price * least(c.discount_value, 100) / 100, 2)
                 else least(c.discount_value, v_price) end;
  return jsonb_build_object(
    'ok', true, 'code', c.code, 'discount_type', c.discount_type, 'discount_value', c.discount_value,
    'discount_qar', v_disc, 'amount_qar', v_price - v_disc);
end;
$$;

revoke all on function public.cc_validate_coupon(text, uuid) from public;
grant execute on function public.cc_validate_coupon(text, uuid) to authenticated, service_role;

-- Creates a payment (reservation). Server only (service role): the server has
-- already checked the plan, the price gate, the coupon and computed amounts.
create or replace function public.cc_create_payment(
  p_user        uuid,
  p_plan        uuid,
  p_cohort      uuid,
  p_coupon      uuid,
  p_addon_plan  uuid,
  p_list        numeric,
  p_discount    numeric,
  p_addon       numeric,
  p_amount      numeric,
  p_method      text,
  p_reference   text,
  p_expires_at  timestamptz,
  p_terms_at    timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cohort  public.cc_cohorts;
  v_taken   integer;
  v_id      uuid;
  v_old     record;
begin
  if p_cohort is not null then
    select * into v_cohort from public.cc_cohorts where id = p_cohort for update;
    if not found or v_cohort.status <> 'open' then
      return jsonb_build_object('ok', false, 'reason', 'cohort_closed');
    end if;
    select count(*)::integer into v_taken
      from (
        select 1 from public.cc_enrollments e
         where e.cohort_id = p_cohort and e.status = 'active' and e.ends_at > now()
        union all
        select 1 from public.cc_payments p
         where p.cohort_id = p_cohort and p.user_id <> p_user
           and ((p.status = 'awaiting_transfer' and (p.expires_at is null or p.expires_at > now()))
                or p.status = 'proof_submitted')
      ) x;
    if v_taken >= v_cohort.seats_total then
      return jsonb_build_object('ok', false, 'reason', 'cohort_full');
    end if;
  end if;

  begin
    -- One open reservation per student: older unpaid ones are cancelled.
    for v_old in
      update public.cc_payments set status = 'cancelled', status_changed_at = now()
       where user_id = p_user and status = 'awaiting_transfer'
       returning id
    loop
      insert into public.cc_audit_log (actor_id, action, entity_type, entity_id, before, after)
      values (null, 'payment.cancelled', 'cc_payment', v_old.id::text,
              jsonb_build_object('status', 'awaiting_transfer'),
              jsonb_build_object('status', 'cancelled', 'reason', 'replaced_by_new_checkout'));
    end loop;

    insert into public.cc_payments (user_id, plan_id, cohort_id, coupon_id, addon_plan_id, list_price_qar,
                                    discount_qar, addon_qar, amount_qar, method, reference_code, status,
                                    expires_at, terms_accepted_at, status_changed_at)
    values (p_user, p_plan, p_cohort, p_coupon, p_addon_plan, p_list, coalesce(p_discount, 0), coalesce(p_addon, 0),
            p_amount, p_method, p_reference, 'awaiting_transfer', p_expires_at, p_terms_at, now())
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'reference_taken');
  end;

  insert into public.cc_audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (p_user, 'payment.created', 'cc_payment', v_id::text, null,
          jsonb_build_object('status', 'awaiting_transfer', 'amount_qar', p_amount, 'method', p_method,
                             'reference_code', p_reference));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.cc_create_payment(uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cc_create_payment(uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, text, text, timestamptz, timestamptz) to service_role;

-- The state machine, server side. Raises on an invalid transition
-- (errcode P0001, message starts with 'cc_invalid_transition'), so a second
-- "approve" on a paid payment fails instead of enrolling twice.
-- p_patch (proof_submitted): proof_storage_path, payer_name, payer_bank,
--   transfer_reference, transferred_at; (any) provider_payment_id,
--   provider_status, raw_payload.
create or replace function public.cc_payment_transition(
  p_payment    uuid,
  p_to         text,
  p_actor      uuid default null,
  p_reason     text default null,
  p_reason_ar  text default null,
  p_patch      jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p         public.cc_payments;
  v_from    text;
  v_days    integer;
  v_start   timestamptz;
  v_enroll  uuid;
  v_patch   jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  select * into p from public.cc_payments where id = p_payment for update;
  if not found then
    raise exception 'cc_payment_not_found' using errcode = 'P0002';
  end if;
  v_from := p.status;
  if not public.cc_payment_transition_allowed(v_from, p_to, p.method) then
    raise exception 'cc_invalid_transition: % -> %', v_from, p_to using errcode = 'P0001';
  end if;
  if p_to = 'rejected' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'cc_reason_required' using errcode = 'P0001';
  end if;
  if p_to = 'proof_submitted' and coalesce(v_patch ->> 'proof_storage_path', '') = '' then
    raise exception 'cc_proof_required' using errcode = 'P0001';
  end if;
  if p_to = 'paid' then
    select pl.duration_days into v_days from public.cc_plans pl where pl.id = p.plan_id;
    if v_days is null or v_days <= 0 then
      raise exception 'cc_plan_duration_missing' using errcode = 'P0001';
    end if;
  end if;

  update public.cc_payments set
    status             = p_to,
    status_changed_at  = now(),
    reviewed_by        = case when p_to in ('paid', 'rejected', 'refunded') then p_actor else reviewed_by end,
    reviewed_at        = case when p_to in ('paid', 'rejected', 'refunded') then now() else reviewed_at end,
    reject_reason      = case when p_to = 'rejected' then btrim(p_reason) else reject_reason end,
    reject_reason_ar   = case when p_to = 'rejected' then nullif(btrim(coalesce(p_reason_ar, '')), '') else reject_reason_ar end,
    proof_storage_path = case when p_to = 'proof_submitted' then v_patch ->> 'proof_storage_path' else proof_storage_path end,
    payer_name         = case when p_to = 'proof_submitted' then v_patch ->> 'payer_name' else payer_name end,
    payer_bank         = case when p_to = 'proof_submitted' then v_patch ->> 'payer_bank' else payer_bank end,
    transfer_reference = case when p_to = 'proof_submitted' then v_patch ->> 'transfer_reference' else transfer_reference end,
    transferred_at     = case when p_to = 'proof_submitted' then (v_patch ->> 'transferred_at')::timestamptz else transferred_at end,
    proof_submitted_at = case when p_to = 'proof_submitted' then now() else proof_submitted_at end,
    paid_at            = case when p_to = 'paid' then now() else paid_at end,
    receipt_number     = case when p_to = 'paid' then coalesce(receipt_number, nextval('public.cc_receipt_number_seq')) else receipt_number end,
    provider_payment_id = coalesce(v_patch ->> 'provider_payment_id', provider_payment_id),
    provider_status    = coalesce(v_patch ->> 'provider_status', provider_status),
    raw_payload        = coalesce(v_patch -> 'raw_payload', raw_payload)
  where id = p_payment
  returning * into p;

  if p_to = 'paid' then
    -- A renewal starts when the current enrollment ends (no lost days).
    select greatest(now(), coalesce(max(e.ends_at), now())) into v_start
      from public.cc_enrollments e
     where e.user_id = p.user_id and e.status = 'active' and e.ends_at > now();
    insert into public.cc_enrollments (user_id, plan_id, cohort_id, payment_id, source, status, starts_at, ends_at)
    values (p.user_id, p.plan_id, p.cohort_id, p.id, 'payment', 'active', v_start, v_start + make_interval(days => v_days))
    on conflict (payment_id) do nothing
    returning id into v_enroll;

    insert into public.cc_journey_progress (user_id, enrolled_at) values (p.user_id, now())
    on conflict (user_id) do update
      set enrolled_at = coalesce(public.cc_journey_progress.enrolled_at, excluded.enrolled_at);

    if p.coupon_id is not null then
      update public.cc_coupons set used_count = used_count + 1 where id = p.coupon_id;
    end if;
  elsif p_to = 'refunded' then
    update public.cc_enrollments set status = 'cancelled' where payment_id = p.id and status = 'active';
  end if;

  insert into public.cc_audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (p_actor, 'payment.' || p_to, 'cc_payment', p.id::text,
          jsonb_build_object('status', v_from),
          jsonb_build_object('status', p_to, 'reason', p_reason, 'amount_qar', p.amount_qar,
                             'receipt_number', p.receipt_number, 'enrollment_id', v_enroll));

  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to, 'user_id', p.user_id,
                            'enrollment_id', v_enroll, 'receipt_number', p.receipt_number);
end;
$$;

revoke all on function public.cc_payment_transition(uuid, text, uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cc_payment_transition(uuid, text, uuid, text, text, jsonb) to service_role;

-- ------------------------------------------------------------- 5. seed
-- price_qar / duration_days NULL = [TODO-MO: price, days]: the join page shows
-- "Price coming soon" and checkout is blocked until the owner sets both
-- (e.g. update public.cc_plans set price_qar = ..., duration_days = ... where slug = 'online').
-- on conflict do nothing: re-running never overwrites what the owner edited.
insert into public.cc_plans (slug, kind, name_en, name_ar, who_for_en, who_for_ar, includes_en, includes_ar,
                             price_qar, duration_days, includes_in_person, is_featured, is_active, sort)
values
  ('online', 'online', 'Online training', 'التدريب عبر الإنترنت',
   'For students who want to build their CAD skills from home, at their own pace.',
   'لمن يريد أن يطوّر مهاراته في التصميم بالحاسوب من البيت وبالسرعة التي تناسبه.',
   array[
     'Every online lesson and the exercise ladder for your track (Inventor or SOLIDWORKS)',
     'Foundations levels 1 to 6',
     'Competition tracks M1, M2 and M3 online',
     'Auto-graded exercises with hints and solution videos',
     'Online mock tests for M1 to M3',
     'Ask a trainer about any lesson',
     'A certificate for each level you finish'
   ],
   array[
     'كل الدروس عبر الإنترنت وسلّم التمارين لمسارك (Inventor أو SOLIDWORKS)',
     'مستويات الأساسيات من 1 إلى 6',
     'مسارات المسابقة M1 وM2 وM3 عبر الإنترنت',
     'تمارين تُصحَّح تلقائيًا مع تلميحات وفيديوهات للحل',
     'اختبارات تجريبية عبر الإنترنت للوحدات M1 إلى M3',
     'اسأل المدرّب عن أي درس',
     'شهادة لكل مستوى تُنهيه'
   ],
   null, null, false, false, true, 10),
  ('online-in-person', 'online_in_person', 'Online + in-person', 'عبر الإنترنت + حضوري',
   'For students preparing seriously for the competition who want hands-on practice at the studio.',
   'لمن يستعد للمسابقة بجدية ويريد تدريبًا عمليًا في الاستوديو.',
   array[
     'Everything in Online training',
     'A seat in an in-person cohort at the Lusail studio (limited seats)',
     'M4 reverse engineering with real measuring instruments',
     '3D scanning and 3D printing sessions',
     'Full-length mock competitions under competition conditions'
   ],
   array[
     'كل ما في التدريب عبر الإنترنت',
     'مقعد في دفعة حضورية في استوديو لوسيل (المقاعد محدودة)',
     'الهندسة العكسية M4 بأدوات قياس حقيقية',
     'جلسات المسح ثلاثي الأبعاد والطباعة ثلاثية الأبعاد',
     'مسابقات تجريبية كاملة بظروف المسابقة الحقيقية'
   ],
   null, null, true, true, true, 20),
  ('measuring-kit', 'kit', 'Student measuring kit', 'حقيبة القياس للطالب',
   'An optional add-on for practising M4 measuring at home.',
   'إضافة اختيارية للتدرّب على قياسات M4 في البيت.',
   array['[TODO-MO: kit contents]'],
   array['[TODO-MO: kit contents]'],
   null, null, false, false, true, 90)
on conflict (slug) do nothing;

-- Existing rows from before this migration get their kind.
update public.cc_plans set kind = 'online_in_person' where includes_in_person and kind = 'online';
