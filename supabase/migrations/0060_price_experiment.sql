-- ============================================================================
-- Gestaltung — 0060: credit-price experiment (invite codes → quoted price)
--                    (P4-02, 2026-10-09)
-- ============================================================================
-- RUN AFTER 0059 (0058 reviews, 0059 youtube). Safe to re-run: the setting
-- is `on conflict (key) do nothing` (owner edits kept), the column and index
-- are `if not exists`, the policy and trigger are dropped and re-created, the
-- functions are `create or replace`, grants are idempotent.
--
-- WHY: the owner wants to test the CREDIT PRICE (e.g. QAR 15 / 20 / 25) with
-- invited users before publishing one. Charging is still the admin granting
-- credits by hand (admin_grant, 0042), so the experiment only changes the
-- price that is DISPLAYED / QUOTED to a cohort. Default OFF.
--
-- CHECKS (read-only; before / after):
--   select key from public.store_settings where key = 'price_experiment';  -- 0 / 1 row
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'profiles'
--      and column_name = 'price_cohort';                                  -- 0 / 1 row
--   select polname, pg_get_expr(polqual, polrelid) from pg_policy
--    where polrelid = 'public.store_settings'::regclass;   -- store_settings_select qual
--   select public.price_experiment_quote('ANY-CODE');      -- null while disabled
--   -- as super admin (Dashboard / SQL editor with a super-admin JWT):
--   select * from public.price_cohort_funnel();
--
-- ROLLBACK (manual, one transaction):
--   drop function if exists public.price_cohort_funnel();
--   drop function if exists public.my_price_quote();
--   drop function if exists public.claim_price_cohort(text);
--   drop function if exists public.price_experiment_quote(text);
--   drop trigger  if exists profiles_guard_price_cohort on public.profiles;
--   drop function if exists public.profiles_guard_price_cohort();
--   drop index    if exists public.profiles_price_cohort_idx;
--   alter table public.profiles drop column if exists price_cohort;
--   delete from public.store_settings where key = 'price_experiment';
--   -- restore the 0025 select policy (every key readable by anon + authenticated):
--   drop policy if exists store_settings_select on public.store_settings;
--   create policy store_settings_select on public.store_settings
--     for select to anon, authenticated using (true);
--
-- WHAT CHANGES
-- 1. store_settings.price_experiment =
--      {"enabled": false, "cohort_codes": [], "variants": []}
--    cohort_codes = invite-code strings; variants =
--    [{"code": "<one of cohort_codes>", "credit_qar": <number>}].
--    Codes compare case-insensitively: upper(btrim(code)) on both sides; a
--    valid code matches ^[A-Z0-9-]{3,32}$ after normalising. credit_qar may
--    be a JSON number or a numeric string ("20"); anything else (junk, ≤ 0)
--    makes that variant invalid (quote → NULL), never an error.
--    Advice for the owner: use codes of 8+ characters (e.g. PRICE-7KQ2M9) —
--    the quote RPC is public, so a 3-letter code could be guessed.
--
-- 2. store_settings SELECT policy — the key above is hidden from the public.
--    Policy store_settings_select (0025) is replaced, same name:
--      OLD: for select to anon, authenticated using (true)
--      NEW: for select to anon, authenticated
--             using (key <> 'price_experiment' or public.is_super_admin())
--    Every OTHER key stays readable by anon and authenticated exactly as
--    before (middleware, public pages, the ISR catalogue are unaffected).
--    Super admin still reads every key (this policy, and also the 0025
--    store_settings_write policy, which is FOR ALL using is_super_admin()).
--    The table-level grants (0025) and the write policy are not touched.
--    SECURITY DEFINER functions below read the row regardless of RLS.
--
-- 3. profiles.price_cohort text null (+ partial index where not null).
--    Protection: a BEFORE INSERT OR UPDATE trigger, profiles_guard_price_cohort,
--    raises 'price_cohort_locked' when a non-trusted caller sets or changes
--    price_cohort. Trusted = super admin, the SQL editor / service role (no
--    JWT, auth.uid() is null — the same rule as the 0009 and 0042 profile
--    guards), or claim_price_cohort() below, which sets the transaction-local
--    setting app.price_cohort_ok = 'on' around its own UPDATE.
--    Why a trigger and not column privileges: authenticated has TABLE-level
--    UPDATE on profiles (0001 grant + Supabase default privileges), and a
--    column-level REVOKE does not override a table-level GRANT. Column
--    privileges would mean revoking UPDATE on the whole table and re-granting
--    every other column by name — fragile (each future column would need a
--    grant, or profile edits silently break). The trigger matches the house
--    pattern (0009 role/tenant, 0042 email) and the profiles_update policy
--    (own row or super admin) stays exactly as it is. Other profile edits
--    (name, locale, phone…) are unaffected: the trigger only fires an error
--    when price_cohort itself changes.
--
-- 4. price_experiment_quote(p_code text) → numeric. SECURITY DEFINER, STABLE,
--    EXECUTE anon + authenticated. Returns the variant's credit_qar when
--    enabled = true AND the normalised code is in cohort_codes AND a variant
--    with that code has credit_qar > 0 (first valid variant in array order);
--    otherwise NULL. Never returns the list of codes or any other setting.
--
-- 5. claim_price_cohort(p_code text) → numeric. SECURITY DEFINER, EXECUTE
--    authenticated only. Caller = auth.uid() (null → null). Quote of p_code
--    null → null, nothing changes. Caller already has a cohort → first code
--    wins: nothing is overwritten and the quote of the STORED cohort is
--    returned (null if that cohort was removed / the experiment is off).
--    Else profiles.price_cohort := normalised code, returns its quote.
--    The UPDATE has `price_cohort is null` in its WHERE (row locked first),
--    so two concurrent claims cannot both write.
--
-- 6. my_price_quote() → table (cohort text, credit_qar numeric). SECURITY
--    DEFINER, STABLE, EXECUTE authenticated. One row when the experiment is
--    enabled and the caller's cohort has a valid variant; else no rows.
--
-- 7. price_cohort_funnel() → table (cohort text, users integer, with_project
--    integer, bought_credits integer, with_order integer). SECURITY DEFINER,
--    STABLE, EXECUTE authenticated, raises 'forbidden' unless
--    is_super_admin(). One row per non-null profiles.price_cohort, ordered by
--    cohort; works whether or not the experiment is enabled.
--      users          = profiles in the cohort
--      with_project   = of those, owning ≥ 1 project with is_test not true (0031)
--      bought_credits = of those, >= 1 credits_ledger row with delta > 0 and
--                       reason 'admin_grant' (how the owner sells credits by
--                       hand today) or 'topup:<payment id>' (reserved, 0042).
--                       'purchase:<order id>' rows are NOT counted: those are
--                       credits EARNED by a delivered store order, not bought.
--                       Negative corrections and 'spend:' / 'redeemed:' rows
--                       never count.
--      with_order     = of those, ≥ 1 part_orders row (profile_id) with
--                       status <> 'cancelled' and is_test not true.
-- ============================================================================

begin;

-- ─── 1. Setting (default OFF; owner edits kept on re-run) ───────────────────
insert into public.store_settings (key, value)
values ('price_experiment', '{"enabled": false, "cohort_codes": [], "variants": []}'::jsonb)
on conflict (key) do nothing;

-- ─── 2. Hide price_experiment from anon / non-admin reads ──────────────────
drop policy if exists store_settings_select on public.store_settings;
create policy store_settings_select on public.store_settings
  for select to anon, authenticated
  using (key <> 'price_experiment' or public.is_super_admin());

-- ─── 3. profiles.price_cohort + guard ───────────────────────────────────────
alter table public.profiles add column if not exists price_cohort text;

create index if not exists profiles_price_cohort_idx
  on public.profiles (price_cohort)
  where price_cohort is not null;

create or replace function public.profiles_guard_price_cohort()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trusted: claim_price_cohort(), SQL editor / service role (no JWT), super admin.
  if coalesce(current_setting('app.price_cohort_ok', true), '') = 'on'
     or auth.uid() is null
     or public.is_super_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.price_cohort is not null then
      raise exception 'price_cohort_locked';
    end if;
  elsif new.price_cohort is distinct from old.price_cohort then
    raise exception 'price_cohort_locked';
  end if;

  return new;
end $$;

revoke all on function public.profiles_guard_price_cohort() from public, anon, authenticated;

drop trigger if exists profiles_guard_price_cohort on public.profiles;
create trigger profiles_guard_price_cohort
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_price_cohort();

-- ─── 4. Public quote for one code ───────────────────────────────────────────
create or replace function public.price_experiment_quote(p_code text)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_cfg  jsonb;
  v_qar  numeric;
begin
  if v_code !~ '^[A-Z0-9-]{3,32}$' then
    return null;
  end if;

  select s.value into v_cfg
    from public.store_settings s
   where s.key = 'price_experiment';

  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    return null;
  end if;
  if coalesce(v_cfg ->> 'enabled', 'false') <> 'true' then
    return null;
  end if;
  if jsonb_typeof(v_cfg -> 'cohort_codes') is distinct from 'array'
     or jsonb_typeof(v_cfg -> 'variants') is distinct from 'array' then
    return null;
  end if;

  -- The code must be one of the invited cohort codes.
  if not exists (
    select 1
      from jsonb_array_elements_text(v_cfg -> 'cohort_codes') as c(code)
     where upper(btrim(c.code)) = v_code
  ) then
    return null;
  end if;

  -- First valid variant for that code (array order). Junk prices are skipped.
  select x.qar into v_qar
    from (
      select case
               when jsonb_typeof(v.elem -> 'credit_qar') = 'number'
                 then (v.elem ->> 'credit_qar')::numeric
               when jsonb_typeof(v.elem -> 'credit_qar') = 'string'
                    and btrim(v.elem ->> 'credit_qar') ~ '^[0-9]{1,9}(\.[0-9]{1,4})?$'
                 then btrim(v.elem ->> 'credit_qar')::numeric
             end as qar,
             v.ord
        from jsonb_array_elements(v_cfg -> 'variants') with ordinality as v(elem, ord)
       where jsonb_typeof(v.elem) = 'object'
         and upper(btrim(coalesce(v.elem ->> 'code', ''))) = v_code
    ) x
   where x.qar is not null
     and x.qar > 0
   order by x.ord
   limit 1;

  return v_qar;  -- null when no valid variant
end $$;

revoke all on function public.price_experiment_quote(text) from public;
grant execute on function public.price_experiment_quote(text) to anon, authenticated;

-- ─── 5. Claim a cohort (first code wins) ────────────────────────────────────
create or replace function public.claim_price_cohort(p_code text)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_quote  numeric;
  v_code   text;
  v_stored text;
begin
  if v_uid is null then
    return null;
  end if;

  v_quote := public.price_experiment_quote(p_code);
  if v_quote is null then
    return null;  -- unknown / disabled code: change nothing
  end if;
  v_code := upper(btrim(p_code));

  select p.price_cohort into v_stored
    from public.profiles p
   where p.id = v_uid
   for update;

  if not found then
    return null;  -- no profile row (should not happen: 0001 creates one per user)
  end if;

  if v_stored is not null then
    return public.price_experiment_quote(v_stored);  -- first code wins
  end if;

  perform set_config('app.price_cohort_ok', 'on', true);
  update public.profiles p
     set price_cohort = v_code
   where p.id = v_uid
     and p.price_cohort is null;
  perform set_config('app.price_cohort_ok', 'off', true);

  return v_quote;
end $$;

revoke all on function public.claim_price_cohort(text) from public;
grant execute on function public.claim_price_cohort(text) to authenticated;

-- ─── 6. The caller's own quote ──────────────────────────────────────────────
create or replace function public.my_price_quote()
returns table (cohort text, credit_qar numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select p.price_cohort as cohort,
         q.qar          as credit_qar
    from public.profiles p
   cross join lateral (select public.price_experiment_quote(p.price_cohort) as qar) q
   where p.id = auth.uid()
     and p.price_cohort is not null
     and q.qar is not null;
$$;

revoke all on function public.my_price_quote() from public;
grant execute on function public.my_price_quote() to authenticated;

-- ─── 7. Funnel per cohort (super admin only) ────────────────────────────────
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

do $$ begin raise notice '0060 applied: store_settings.price_experiment (off, hidden from anon via store_settings_select), profiles.price_cohort + guard trigger (price_cohort_locked), price_experiment_quote, claim_price_cohort, my_price_quote, price_cohort_funnel'; end $$;

commit;
