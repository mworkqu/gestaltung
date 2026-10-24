-- ============================================================================
-- Gestaltung — 0105: supplier cost and margins are admin-only
--                    (security audit 2026-10, finding DB-09)
-- ============================================================================
-- Problem: `grant select on public.parts to anon, authenticated` (0011) plus
-- a row-only policy meant anyone with the public anon key could read
--   GET /rest/v1/parts?select=sku,unit_price,landed_cost_qar,income_pct
-- — the whole catalogue's landed cost, expected income and margin — and
-- store_settings exposed the margin / commission floors and FX rates.
--
-- This migration:
--   1. parts: the TABLE-level SELECT of anon / authenticated is replaced by a
--      COLUMN-level SELECT on every column EXCEPT
--        landed_cost_qar, expected_income_qar, income_pct, below_floor,
--        pinned_offer_id, preferred_offer_id, pricing_mode.
--      (A column REVOKE alone does nothing while a table-level grant exists,
--      so the table grant is revoked and the other columns granted by name,
--      generated from the live column list.) Row RLS is unchanged.
--      Consequences: `select=*` on parts by anon / authenticated is now
--      "permission denied" (the app names its columns: PART_PUBLIC_COLUMNS in
--      lib/store/part-columns.ts); filters / ORDER BY / RETURNING on a hidden
--      column fail the same way. INSERT / UPDATE / DELETE privileges are
--      unchanged (admins still write pricing_mode / pinned_offer_id).
--      service_role keeps the whole table. A column added to parts later must
--      be granted to anon/authenticated in its own migration (or it is
--      hidden by default).
--      RE-RUN WARNING: the public column list is rebuilt from pg_attribute on
--      every run, so re-running 0105 after a new parts column was added
--      GRANTS THAT COLUMN TO anon/authenticated. If the new column is private,
--      add it to the excluded list (and to the asserts below) first.
--      A post-condition block raises if anon or authenticated can still read
--      any hidden column (e.g. through a grant to PUBLIC, which a revoke from
--      anon/authenticated does not remove), so the migration never reports
--      success while cost is readable.
--   2. public.parts_admin: a view `select * from parts` with the row filter
--      is_super_admin() (or service_role), owned by the migration role and
--      NOT security_invoker, so admins read the hidden columns through it
--      (lib/store/part-columns.ts readPartsAdmin). SELECT for authenticated
--      and service_role only. security_barrier = true, so no caller-supplied
--      filter (PostgREST operators) is evaluated before the admin row filter.
--      Its column list is FROZEN when the view is created (`p.*` is expanded
--      then): a column added to parts later is missing from parts_admin
--      until the view is re-created — re-run this section (create or replace
--      view appends the new columns; mind the re-run warning above for
--      section 1) or recreate the view in the migration that adds the column.
--   3. store_settings_select: anon / non-admin sessions no longer see these
--      business-internal keys (super_admin and service_role unchanged):
--        price_experiment (already hidden, 0060), margin_floor_pct,
--        commission_floor_pct, fx_to_qar, anonymous_cleanup, backup_search,
--        ai_limits, restock_weights, voltaat_sync, fix_on_request,
--        csv_mapping:<supplier>.
--      Every other key stays readable: public pages, the middleware and
--      guest sessions read them (decision per key in the commit body).
--
-- App side (same commit): every select("*") / parts(*) embed on parts by the
-- browser or a session names PART_PUBLIC_COLUMNS; admin pages that show cost
-- read parts_admin (falling back to the table until this runs).
-- Every public reader names its columns (the last one, components/prototyping/
-- workspace.tsx, in commit 2e52716), so deploy the app commit first, then run this.
--
-- RUN AFTER 0099 (and 0100-0104). Safe to re-run.
--
-- ROLLBACK (manual):
--   -- The table grant alone restores the old behaviour (it covers every column).
--   -- Clear section 1's per-column grants by name as well, so the privileges are
--   -- back exactly as 0011 left them and a later table-level revoke is enough.
--   do $$
--   declare v_cols text;
--   begin
--     select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
--       from pg_attribute
--      where attrelid = 'public.parts'::regclass and attnum > 0 and not attisdropped;
--     execute format('revoke select (%s) on table public.parts from anon, authenticated', v_cols);
--   end $$;
--   grant select on public.parts to anon, authenticated;
--   drop view if exists public.parts_admin;
--   drop policy if exists store_settings_select on public.store_settings;
--   create policy store_settings_select on public.store_settings
--     for select to anon, authenticated
--     using (key <> 'price_experiment' or public.is_super_admin());
-- ============================================================================

-- ── 1. parts: every column but the cost / sourcing ones ─────────────────────
do $$
declare
  v_cols text;
begin
  revoke select on table public.parts from anon, authenticated;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.parts'::regclass
     and a.attnum > 0
     and not a.attisdropped
     and a.attname not in ('landed_cost_qar', 'expected_income_qar', 'income_pct', 'below_floor',
                           'pinned_offer_id', 'preferred_offer_id', 'pricing_mode');

  execute format('grant select (%s) on table public.parts to anon, authenticated', v_cols);

  -- Explicit, in case a column-level grant on them exists from elsewhere.
  revoke select (landed_cost_qar, expected_income_qar, income_pct, below_floor,
                 pinned_offer_id, preferred_offer_id, pricing_mode)
    on table public.parts from anon, authenticated;
end $$;

grant select on table public.parts to service_role;

-- Post-condition: no hidden column is readable by anon / authenticated by ANY
-- route (direct, PUBLIC, an inherited role). has_column_privilege is true for
-- a table-level grant too, so this also catches a table grant left behind.
do $$
declare
  v_role text;
  v_col  text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    foreach v_col in array array['landed_cost_qar', 'expected_income_qar', 'income_pct', 'below_floor',
                                 'pinned_offer_id', 'preferred_offer_id', 'pricing_mode'] loop
      if has_column_privilege(v_role, 'public.parts', v_col, 'select') then
        raise exception '0105: % can still SELECT public.parts.% (check grants to PUBLIC or roles % inherits from)',
          v_role, v_col, v_role;
      end if;
    end loop;
  end loop;
end $$;

-- ── 2. The admin read view ──────────────────────────────────────────────────
create or replace view public.parts_admin
with (security_invoker = false, security_barrier = true) as
  select p.*
    from public.parts p
   where public.is_super_admin()
      or coalesce(auth.role(), '') = 'service_role';

comment on view public.parts_admin is
  'Every parts column (incl. landed cost / margin / pricing mode) for super_admin sessions only (0105 / DB-09).';

revoke all on table public.parts_admin from public, anon, authenticated;
grant select on table public.parts_admin to authenticated, service_role;

do $$
begin
  if has_table_privilege('anon', 'public.parts_admin', 'select') then
    raise exception '0105: anon can still SELECT public.parts_admin (check grants to PUBLIC)';
  end if;
end $$;

-- ── 3. store_settings: hide internal keys from the public ───────────────────
drop policy if exists store_settings_select on public.store_settings;
create policy store_settings_select on public.store_settings
  for select to anon, authenticated
  using (
    public.is_super_admin()
    or not (
      key in ('price_experiment', 'margin_floor_pct', 'commission_floor_pct', 'fx_to_qar',
              'anonymous_cleanup', 'backup_search', 'ai_limits', 'restock_weights',
              'voltaat_sync', 'fix_on_request')
      or key like 'csv\_mapping:%'
    )
  );

-- PostgREST: pick up the new view / privileges at once.
notify pgrst, 'reload schema';

do $$ begin raise notice '0105 applied: parts cost columns hidden from anon/authenticated, parts_admin view, store_settings internal keys hidden'; end $$;
