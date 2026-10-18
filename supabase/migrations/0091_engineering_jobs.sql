-- Gestaltung — 0091: engineering jobs queue (owner, 2026-10-18). Run after 0090.
--
-- An engineering job is work our engineers deliver within hours, not seconds:
--   * step_model   — Engineers level: a full, editable STEP file of the whole
--                    project (~10 ideation tokens, lib/engineering/config.ts);
--   * pcb_gerber, assembly, cad_engineer — phase 4 (engineer services, paid by
--                    Fawran through payments; payment_id links them).
-- Flow: the user submits (tokens taken, pass tokens first) → queued → an admin
-- starts it, uploads the result to the private 'engineering-files' bucket and
-- marks it ready → the user gets an email ('engineering_job_ready') and the
-- file on the project's Engineering page. A failed or cancelled job gives the
-- tokens back (as bought tokens, which never expire). The user may upload an
-- edited STEP back for us to manufacture (returned_path).
--
-- Rollback:
--   drop function if exists public.engineering_job_submit(uuid, uuid, text, integer, jsonb, text, integer, boolean, uuid),
--     public.engineering_job_cancel(uuid), public.engineering_job_return(uuid, text),
--     public.admin_engineering_job_set(uuid, text, text, text, text), public.engineering_job_refund_internal(uuid);
--   drop table if exists public.engineering_jobs;
--   (and restore 0053's notification_outbox_kind_check)

create table if not exists public.engineering_jobs (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects (id) on delete set null,
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           text not null check (kind in ('step_model', 'pcb_gerber', 'assembly', 'cad_engineer')),
  status         text not null default 'queued' check (status in ('queued', 'in_progress', 'ready', 'failed', 'cancelled')),
  tokens         integer not null default 0 check (tokens >= 0),
  payment_id     uuid references public.payments (id) on delete set null,
  eta_at         timestamptz,
  snapshot       jsonb,
  note           text,
  quote          jsonb,
  result_path    text,
  result_name    text,
  admin_note     text,
  returned_path  text,
  returned_at    timestamptz,
  started_at     timestamptz,
  ready_at       timestamptz,
  is_test        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists engineering_jobs_user_idx on public.engineering_jobs (user_id, created_at desc);
create index if not exists engineering_jobs_project_idx on public.engineering_jobs (project_id, created_at desc);
create index if not exists engineering_jobs_open_idx on public.engineering_jobs (status, created_at) where status in ('queued', 'in_progress');

alter table public.engineering_jobs enable row level security;
revoke insert, update, delete on public.engineering_jobs from anon, authenticated;
grant select on public.engineering_jobs to authenticated;

drop policy if exists engineering_jobs_select on public.engineering_jobs;
create policy engineering_jobs_select on public.engineering_jobs
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

-- ─── Files: results (admin) and edited files sent back (user's own folder) ──
insert into storage.buckets (id, name, public, file_size_limit)
values ('engineering-files', 'engineering-files', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = 104857600;

drop policy if exists engineering_files_user_insert on storage.objects;
create policy engineering_files_user_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'engineering-files' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists engineering_files_read on storage.objects;
create policy engineering_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'engineering-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin()));

drop policy if exists engineering_files_admin_write on storage.objects;
create policy engineering_files_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'engineering-files' and public.is_super_admin())
  with check (bucket_id = 'engineering-files' and public.is_super_admin());

-- ─── Notification kind ──────────────────────────────────────────────────────
alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check
  check (kind in ('credits_order_delivered', 'credits_admin_grant', 'first_project', 'first_circuit', 'discount_ready',
                  'order_confirmed', 'order_paid', 'order_sourcing', 'order_shipped', 'order_delivered', 'order_cancelled',
                  'engineering_job_ready'));

update public.store_settings
   set value = '{"engineering_job_ready": true}'::jsonb || coalesce(value, '{}'::jsonb)
 where key = 'notifications';

-- ─── Submit (service role: the server route decides the token amount) ───────
create or replace function public.engineering_job_submit(
  p_user uuid, p_project uuid, p_kind text, p_tokens integer, p_snapshot jsonb, p_note text, p_eta_hours integer,
  p_free boolean default false, p_payment uuid default null
) returns public.engineering_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tokens integer := case when coalesce(p_free, false) then 0 else greatest(coalesce(p_tokens, 0), 0) end;
  v_pb     integer;
  v_bb     integer;
  v_from_pass integer;
  v_job    public.engineering_jobs;
begin
  if not exists (select 1 from public.projects where id = p_project and user_id = p_user)
     and not coalesce(p_free, false) then
    raise exception 'not_found';
  end if;
  if exists (select 1 from public.engineering_jobs where project_id = p_project and kind = p_kind and status in ('queued', 'in_progress')) then
    raise exception 'already_open';
  end if;

  perform pg_advisory_xact_lock(hashtext('idea:' || p_user::text));
  perform public.idea_pass_sweep(p_user);
  v_pb := greatest(public.credit_balance_of(p_user, 'idea_pass'), 0);
  v_bb := greatest(public.credit_balance_of(p_user, 'idea'), 0);
  if v_tokens > v_pb + v_bb then raise exception 'no_tokens'; end if;

  insert into public.engineering_jobs (project_id, user_id, kind, tokens, payment_id, eta_at, snapshot, note)
  values (p_project, p_user, p_kind, v_tokens, p_payment,
          now() + make_interval(hours => greatest(coalesce(p_eta_hours, 3), 1)),
          p_snapshot, nullif(left(btrim(coalesce(p_note, '')), 1000), ''))
  returning * into v_job;

  v_from_pass := least(v_tokens, v_pb);
  if v_from_pass > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (p_user, 'idea_pass', -v_from_pass, 'job:' || v_job.id::text, p_kind);
  end if;
  if v_tokens - v_from_pass > 0 then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (p_user, 'idea', -(v_tokens - v_from_pass), 'job:' || v_job.id::text, p_kind);
  end if;
  return v_job;
end $$;

revoke all on function public.engineering_job_submit(uuid, uuid, text, integer, jsonb, text, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.engineering_job_submit(uuid, uuid, text, integer, jsonb, text, integer, boolean, uuid) to service_role;

-- Tokens back as bought tokens (never expire). Once per job.
create or replace function public.engineering_job_refund_internal(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.engineering_jobs;
begin
  select * into j from public.engineering_jobs where id = p_job;
  if j.tokens > 0 and not exists (select 1 from public.credits_ledger where reason = 'job_refund:' || j.id::text) then
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (j.user_id, 'idea', j.tokens, 'job_refund:' || j.id::text, 'Engineering job refund');
  end if;
end $$;

revoke all on function public.engineering_job_refund_internal(uuid) from public, anon, authenticated;

create or replace function public.engineering_job_cancel(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.engineering_jobs set status = 'cancelled', updated_at = now()
   where id = p_job and user_id = auth.uid() and status = 'queued';
  if not found then raise exception 'not_open'; end if;
  perform public.engineering_job_refund_internal(p_job);
end $$;

revoke all on function public.engineering_job_cancel(uuid) from public, anon;
grant execute on function public.engineering_job_cancel(uuid) to authenticated;

-- The user's edited file, uploaded to engineering-files/<uid>/…, sent back to us.
create or replace function public.engineering_job_return(p_job uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text or p_path like '%..%' then raise exception 'bad_path'; end if;
  update public.engineering_jobs set returned_path = p_path, returned_at = now(), updated_at = now()
   where id = p_job and user_id = auth.uid() and status = 'ready';
  if not found then raise exception 'not_ready'; end if;
end $$;

revoke all on function public.engineering_job_return(uuid, text) from public, anon;
grant execute on function public.engineering_job_return(uuid, text) to authenticated;

-- ─── Admin: start / ready (with the file) / failed ──────────────────────────
create or replace function public.admin_engineering_job_set(p_job uuid, p_status text, p_result_path text, p_result_name text, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  j      public.engineering_jobs;
  v_name text;
begin
  if not public.is_super_admin() then raise exception 'not allowed'; end if;
  select * into j from public.engineering_jobs where id = p_job for update;
  if j.id is null then raise exception 'not_found'; end if;

  if p_status = 'in_progress' and j.status = 'queued' then
    update public.engineering_jobs set status = 'in_progress', started_at = now(), admin_note = coalesce(nullif(btrim(p_note), ''), admin_note), updated_at = now()
     where id = j.id;
  elsif p_status = 'ready' and j.status in ('queued', 'in_progress', 'ready') then
    if nullif(btrim(coalesce(p_result_path, '')), '') is null then raise exception 'file_required'; end if;
    update public.engineering_jobs
       set status = 'ready', result_path = p_result_path, result_name = nullif(left(btrim(coalesce(p_result_name, '')), 200), ''),
           ready_at = coalesce(ready_at, now()), started_at = coalesce(started_at, now()),
           admin_note = coalesce(nullif(btrim(p_note), ''), admin_note), updated_at = now()
     where id = j.id;
    select name into v_name from public.projects where id = j.project_id;
    perform public.notification_enqueue(j.user_id, 'engineering_job_ready', jsonb_build_object(
      'ref', j.id::text, 'job_kind', j.kind, 'project_id', j.project_id, 'project_name', v_name));
  elsif p_status = 'failed' and j.status in ('queued', 'in_progress') then
    update public.engineering_jobs set status = 'failed', admin_note = coalesce(nullif(btrim(p_note), ''), admin_note), updated_at = now()
     where id = j.id;
    perform public.engineering_job_refund_internal(j.id);
  else
    raise exception 'bad_transition';
  end if;
  return p_status;
end $$;

revoke all on function public.admin_engineering_job_set(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_engineering_job_set(uuid, text, text, text, text) to authenticated;

do $$ begin raise notice '0091 applied: engineering_jobs queue, engineering-files bucket, engineering_job_ready email'; end $$;
