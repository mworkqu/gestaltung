-- ============================================================================
-- 0061_price_funnel_fix.sql — P4-02 follow-up (2026-10-09)
-- RUN AFTER 0060. Safe to re-run (create or replace only; no data change).
--
-- WHY: 0060 was written with price_cohort_funnel().bought_credits counting
-- credits_ledger rows with reason 'purchase:%' as "bought". Those rows are
-- credits EARNED by a delivered store order (0042), not credits a customer
-- paid for, so they inflated the experiment's conversion. The 0060 file in the
-- repo was corrected shortly after it was written, but the owner may have run
-- the earlier text; this migration makes the live function match either way.
--
-- WHAT CHANGES: price_cohort_funnel() — same signature, same grants, same
-- super-admin check; bought_credits = users with >= 1 credits_ledger row with
-- delta > 0 and reason 'admin_grant' (how credits are sold by hand today) or
-- 'topup:%' (reserved, 0042). Nothing else is touched.
--
-- ROLLBACK: re-run the price_cohort_funnel() block of 0060.
-- ============================================================================

begin;

create or replace function public.price_cohort_funnel()
returns table (cohort text, users integer, with_project integer, bought_credits integer, with_order integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with members as (
    select p.price_cohort as m_cohort,
           exists (
             select 1 from public.projects pr
              where pr.user_id = p.id
                and pr.is_test is not true
           ) as m_project,
           exists (
             select 1 from public.credits_ledger l
              where l.user_id = p.id
                and l.delta > 0
                and (l.reason like 'topup:%'
                     or l.reason = 'admin_grant')
           ) as m_credits,
           exists (
             select 1 from public.part_orders o
              where o.profile_id = p.id
                and o.status <> 'cancelled'
                and o.is_test is not true
           ) as m_order
      from public.profiles p
     where p.price_cohort is not null
  )
  select m.m_cohort,
         count(*)::integer,
         count(*) filter (where m.m_project)::integer,
         count(*) filter (where m.m_credits)::integer,
         count(*) filter (where m.m_order)::integer
    from members m
   group by m.m_cohort
   order by m.m_cohort;
end $$;

revoke all on function public.price_cohort_funnel() from public;
grant execute on function public.price_cohort_funnel() to authenticated;

do $$ begin raise notice '0061 applied: price_cohort_funnel() counts only admin_grant / topup: credits as bought'; end $$;

commit;
