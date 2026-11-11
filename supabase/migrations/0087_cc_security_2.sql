-- 0087_cc_security_2.sql — CAD Champions security follow-up (Prompt 12 Step A,
-- docs/cad-champions/SECURITY_REVIEW.md).
--
-- RUN AFTER 0086. Safe to re-run (create table/index if not exists, create or
-- replace function, drop policy if exists + create).
-- NOTE: re-running 0077 or 0078 restores the old, looser policies, and
-- re-running 0084 restores the unthrottled coupon check; run 0083, 0086 and
-- then 0087 again afterwards (docs/cad-champions/DEPLOY.md, SR-L6).
--
-- Closes:
--   SR-M1  coupon codes could be guessed through PostgREST /rpc/cc_validate_coupon
--          (unlimited). The function now allows 10 checks per user per
--          10 minutes (table cc_coupon_attempts, definer-only) and answers
--          reason 'too_many' after that.
--   SR-M7  no per-user storage quota. New cc_storage_used_bytes(user) (service
--          role only; the app enforces the quota with a clear message), and the
--          own-folder insert policies of cc-submissions / cc-payment-proofs now
--          refuse a new object when the user already stores >= 2 GiB in
--          cc-submissions, or has created >= 200 objects in either bucket in the
--          last 24 hours. Staff and the service role are not limited.
--   SR-L1  instructors could read every payment row (payer name, bank, transfer
--          reference). Payments are now owner + CC admin only.
--   SR-L2  cc_has_active_enrollment(p_user) answered for any user id (and anon
--          could call it: 0077 never revoked PUBLIC's execute). It now answers
--          false unless p_user is the caller, the caller is staff, or there is
--          no session (service role); anon can no longer call it.
--   SR-L3  a student could self-insert the grader-only Get Ready key
--          'practice_upload'. Own insert/update now refuse that key; the app
--          writes it with the service role after the grader passes the file.
--   SR-L4  a grade query could reference another student's attempt, and
--          image_path was unconstrained. Own insert now requires an own attempt
--          and an image under the asker's folder.
--   SR-L5  answered public FAQ rows exposed the asker's user_id. Students now
--          read only their own questions; the lesson page reads public FAQs
--          server-side (service role, id/body/answer only).
--
-- Rollback (restores 0077 / 0078 / 0084 behaviour):
--   re-run the 0077 policy blocks for cc_payments_select, cc_get_ready_steps_insert_own,
--   cc_get_ready_steps_update_own, cc_lesson_questions_select, cc_lesson_questions_insert_own
--   and the cc_has_active_enrollment function; re-run the 0078 policies
--   cc_submissions_insert_own and cc_payment_proofs_insert_own; re-run the 0084
--   cc_validate_coupon function; then
--   drop function if exists public.cc_storage_used_bytes(uuid), public.cc_storage_upload_allowed(text);
--   drop table if exists public.cc_coupon_attempts;

-- ============================================================ SR-M1 coupons
create table if not exists public.cc_coupon_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
alter table public.cc_coupon_attempts enable row level security; -- no policies: definer-only
revoke all on public.cc_coupon_attempts from anon, authenticated;
create index if not exists cc_coupon_attempts_idx on public.cc_coupon_attempts (user_id, at);

-- Same rules as 0084, plus the throttle. VOLATILE now (it writes an attempt row).
create or replace function public.cc_validate_coupon(p_code text, p_plan uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c        public.cc_coupons;
  v_uid    uuid := auth.uid();
  v_inst   text;
  v_price  numeric;
  v_disc   numeric;
begin
  -- Called with the student's session (the institution rule needs auth.uid()).
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'signed_out');
  end if;
  -- SR-M1: at most 10 checks per user per 10 minutes, whatever the code.
  if (select count(*) from public.cc_coupon_attempts a
       where a.user_id = v_uid and a.at > now() - interval '10 minutes') >= 10 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  delete from public.cc_coupon_attempts a where a.user_id = v_uid and a.at < now() - interval '1 day';
  insert into public.cc_coupon_attempts (user_id) values (v_uid);

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
    select pr.institution into v_inst from public.cc_profiles pr where pr.id = v_uid;
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

-- ======================================================= SR-L1 payments
drop policy if exists cc_payments_select on public.cc_payments;
create policy cc_payments_select on public.cc_payments
  for select to authenticated
  using (user_id = (select auth.uid()) or public.cc_is_admin());

-- ================================================ SR-L2 enrollment check
create or replace function public.cc_has_active_enrollment(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.cc_enrollments e
     where e.user_id = p_user and e.status = 'active'
       and e.starts_at <= now() and e.ends_at > now()
       and (p_user = (select auth.uid()) or (select auth.uid()) is null or public.cc_is_staff())
  );
$$;
-- 0077 granted execute without revoking PUBLIC's default, so anon could call it
-- too (and with no session it counts as the service role above). Close that.
revoke all on function public.cc_has_active_enrollment(uuid) from public, anon;
grant execute on function public.cc_has_active_enrollment(uuid) to authenticated, service_role;

-- =============================================== SR-L3 Get Ready steps
drop policy if exists cc_get_ready_steps_insert_own on public.cc_get_ready_steps;
create policy cc_get_ready_steps_insert_own on public.cc_get_ready_steps
  for insert to authenticated
  with check (user_id = (select auth.uid()) and step_key <> 'practice_upload');

drop policy if exists cc_get_ready_steps_update_own on public.cc_get_ready_steps;
create policy cc_get_ready_steps_update_own on public.cc_get_ready_steps
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and step_key <> 'practice_upload');

-- ==================================== SR-L4 + SR-L5 lesson questions
-- SR-L5: no more "public answered FAQ" branch; the app reads FAQs with the
-- service role and shows only id, body and answer.
drop policy if exists cc_lesson_questions_select on public.cc_lesson_questions;
create policy cc_lesson_questions_select on public.cc_lesson_questions
  for select to authenticated
  using (user_id = (select auth.uid()) or public.cc_is_staff());

drop policy if exists cc_lesson_questions_insert_own on public.cc_lesson_questions;
create policy cc_lesson_questions_insert_own on public.cc_lesson_questions
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'open' and answer is null
              and answered_by is null and answered_at is null and not public
              and (attempt_id is null or exists (
                    select 1 from public.cc_attempts a
                     where a.id = attempt_id and a.user_id = (select auth.uid())))
              and (image_path is null or image_path like (select auth.uid())::text || '/%'));

-- ======================================================= SR-M7 storage quota
-- Bytes a user stores in cc-submissions (test files, package ZIPs, practice
-- uploads, exercise files, question screenshots). Size comes from
-- storage.objects.metadata->>'size' (set by Supabase Storage).
create or replace function public.cc_storage_used_bytes(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0)::bigint
    from storage.objects o
   where o.bucket_id = 'cc-submissions'
     and o.name like p_user::text || '/%';
$$;
revoke all on function public.cc_storage_used_bytes(uuid) from public, anon, authenticated;
grant execute on function public.cc_storage_used_bytes(uuid) to service_role;

-- Used by the insert policies below. Keep 2147483648 (2 GiB) and 200 in step
-- with CC_STORAGE_QUOTA_BYTES / CC_UPLOADS_PER_DAY in lib/cad-champions/upload/quota.ts.
create or replace function public.cc_storage_upload_allowed(p_bucket text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  if public.cc_is_staff() then
    return true;
  end if;
  if (select count(*) from storage.objects o
       where o.bucket_id in ('cc-submissions', 'cc-payment-proofs')
         and o.name like v_uid::text || '/%'
         and o.created_at > now() - interval '24 hours') >= 200 then
    return false;
  end if;
  if p_bucket = 'cc-submissions' and public.cc_storage_used_bytes(v_uid) >= 2147483648 then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.cc_storage_upload_allowed(text) from public, anon;
grant execute on function public.cc_storage_upload_allowed(text) to authenticated, service_role;

drop policy if exists cc_submissions_insert_own on storage.objects;
create policy cc_submissions_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cc-submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.cc_storage_upload_allowed('cc-submissions')
  );

drop policy if exists cc_payment_proofs_insert_own on storage.objects;
create policy cc_payment_proofs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cc-payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.cc_storage_upload_allowed('cc-payment-proofs')
  );
