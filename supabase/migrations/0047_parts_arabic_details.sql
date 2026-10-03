-- ============================================================================
-- Gestaltung — 0047: Arabic product descriptions and spec tables
--                    (2026-10-03, Phase E1 — Arabic)
-- ============================================================================
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   -- which of the columns exist now (expect description_ar only — it has
--   -- been there since 0011; specs_ar and details_ar_at are new)
--   select column_name, data_type from information_schema.columns
--    where table_schema = 'public' and table_name = 'parts'
--      and column_name in ('description_ar', 'specs', 'specs_ar', 'details_ar_at');
--
--   -- how many published products the admin step will work through, and how
--   -- many already carry a hand-written description_ar (kept, not re-sent)
--   select count(*) as published,
--          count(*) filter (where coalesce(btrim(description_ar), '') <> '') as with_description_ar,
--          count(*) filter (where jsonb_typeof(specs) = 'array' and jsonb_array_length(specs) > 0) as with_specs
--     from public.parts where is_published and merged_into is null;
--
--   -- anon already reads every parts column through the table grant (0011);
--   -- expect anon/authenticated with SELECT here and no column-level grants
--   select grantee, privilege_type from information_schema.role_table_grants
--    where table_schema = 'public' and table_name = 'parts' and grantee in ('anon', 'authenticated');
--   select grantee, column_name from information_schema.column_privileges
--    where table_schema = 'public' and table_name = 'parts' and grantee = 'anon' limit 5;
--
-- ROLLBACK (manual, run as one transaction):
--   drop index if exists public.parts_details_ar_todo_idx;
--   alter table public.parts drop column if exists details_ar_at;
--   alter table public.parts drop column if exists specs_ar;
--   (description_ar is NOT dropped: it predates this migration (0011) and
--   holds hand-written Arabic too. To clear only machine translations, run
--   `update public.parts set description_ar = null where details_ar_at is not null;`
--   BEFORE dropping details_ar_at.)
--   The site keeps working after a rollback: the product page reads parts
--   with select('*') and shows the Arabic headings with a "not translated yet"
--   note; the admin step answers {error: "run_0047"}.
--
-- WHAT CHANGES
-- 1. parts.description_ar text — `add column if not exists`: already there
--    since 0011, so normally a no-op (listed so the migration is self-
--    describing).
-- 2. parts.specs_ar jsonb — the spec table in Arabic, SAME SHAPE as the
--    English rows the product page shows:
--      [{ "name": "جهد التشغيل", "value": "7–24V DC" }, …]
--    aligned one for one with the English rows (parts.specs from 0041 when
--    present, else the "Specifications" bullets in parts.description — see
--    lib/store/specs.ts productSpecs). [] = the product has no spec rows;
--    null = not translated yet.
-- 3. parts.details_ar_at timestamptz — when the admin "translate_details"
--    step (app/api/admin/store-cleanup) last wrote this product's Arabic
--    details. null = still to do; the step skips non-null rows unless the
--    owner ticks "Redo all" (force).
-- 4. Partial index over the products the step still has to do.
--
-- No grants, policies or views change: 0011 granted SELECT on the whole
-- table to anon/authenticated and parts_public_select limits rows to
-- is_published, so the new columns are readable exactly like description.
-- The store's slim card query names its own columns and is unaffected.
-- Nothing is translated by this migration; the owner runs the admin step.
--
-- Run after 0046. Safe to re-run.
-- ============================================================================

begin;

alter table public.parts add column if not exists description_ar text;
alter table public.parts add column if not exists specs_ar jsonb;
alter table public.parts add column if not exists details_ar_at timestamptz;

comment on column public.parts.specs_ar is
  'Arabic spec rows [{name, value}], aligned with the English rows shown on the product page; [] = none, null = not translated (0047).';
comment on column public.parts.details_ar_at is
  'When the admin translate_details step last wrote description_ar/specs_ar; null = still to do (0047).';

create index if not exists parts_details_ar_todo_idx
  on public.parts (sku)
  where details_ar_at is null and is_published and merged_into is null;

do $$
declare
  todo integer;
begin
  select count(*) into todo from public.parts
   where details_ar_at is null and is_published and merged_into is null;
  raise notice '0047 applied: parts.specs_ar, parts.details_ar_at (description_ar kept); % published products to translate', todo;
end $$;

commit;
