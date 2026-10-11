-- Gestaltung — 0075: educational-email grant = 2 wiring credits + 1 CAD credit
-- (owner, 2026-10-11; 0074 granted 1 + 1).
--
-- 1. edu_credit_grant() now inserts wiring +2 and cad +1 (reason 'edu_grant',
--    still once per account and once per email via edu_credit_grants).
-- 2. Top-up: every account already granted by 0074 whose edu_grant wiring total
--    is below 2 gets the missing wiring credit(s), reason 'edu_grant', note
--    'Educational email (top-up)'. Safe to re-run: a second run finds every
--    account at 2 and adds nothing.
-- Run AFTER 0074.

create or replace function public.edu_credit_grant(p_user uuid, p_email text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_user is null or not public.is_edu_email(p_email) then return false; end if;

  insert into public.edu_credit_grants (email_key, user_id)
  values (public.edu_email_key(p_email), p_user)
  on conflict do nothing;                 -- same email OR same account already granted
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return false; end if;

  insert into public.credits_ledger (user_id, kind, delta, reason, note) values
    (p_user, 'wiring', 2, 'edu_grant', 'Educational email'),
    (p_user, 'cad',    1, 'edu_grant', 'Educational email');
  return true;
end $$;

revoke all on function public.edu_credit_grant(uuid, text) from public, anon, authenticated;

do $$
declare
  n integer;
begin
  with short as (
    select g.user_id, 2 - coalesce(sum(l.delta) filter (where l.kind = 'wiring'), 0) as missing
    from public.edu_credit_grants g
    left join public.credits_ledger l
      on l.user_id = g.user_id and l.reason = 'edu_grant'
    group by g.user_id
  ), ins as (
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    select user_id, 'wiring', missing, 'edu_grant', 'Educational email (top-up)'
    from short
    where missing > 0
    returning 1
  )
  select count(*) into n from ins;
  raise notice '0075 applied: edu grant = 2 wiring + 1 cad; topped up % account(s)', n;
end $$;
