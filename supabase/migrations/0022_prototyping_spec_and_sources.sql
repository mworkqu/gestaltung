-- ============================================================================
-- Gestaltung — 0022: prototyping spec sheet + part sources
-- ============================================================================
-- 1. projects.spec — "What we understood" as a spec sheet plus the open
--    questions, replacing the per-sentence rows in project_claims. Shape
--    (lib/prototyping/spec.ts):
--      { summary, rows:[{id,label,value,source,edited,analysisValue}],
--        questions:[{id,label,type,options}], confirmed, provider, fallback }
--    A user-edited row always wins over a later analysis; the analysis value
--    is kept beside it so the UI can say "kept your answer".
--    project_claims is RETIRED: nothing reads or writes it any more. It is left
--    in place (not dropped) so no one's history disappears with a migration.
--
-- 2. project_parts gains a source. A part is either
--      catalog   — an existing Store part or an item from My Inventory,
--                  orderable today; SKU / price / stock copied at add time;
--      to_design — something that has to be designed and made, with a kind
--                  (mechanical | electronics | software) and no price.
--    One row, two views: the parts table shows every row, the discipline
--    branches show only to_design rows of their kind. Deleting the row
--    removes it from both; schematics keep `on delete set null` from 0020.
--    Lead time is deliberately NOT a column: neither the Store nor My
--    Inventory records one, and we do not display figures we cannot source.
--
-- Also re-adds projects.disciplines (0021) idempotently, so running only this
-- file on a database that skipped 0021 still works.
--
-- RLS: unchanged. Both tables are already gated by owns_project() (0015/0020).
-- Run after 0021 (or 0020). Safe to re-run.
-- ============================================================================

alter table public.projects
  add column if not exists spec        jsonb,
  add column if not exists disciplines jsonb not null default '{}'::jsonb;

alter table public.project_parts
  add column if not exists source            text not null default 'to_design',
  add column if not exists kind              text,
  add column if not exists catalog_part_id   uuid references public.parts (id) on delete set null,
  add column if not exists inventory_item_id uuid references public.client_inventory_items (id) on delete set null,
  add column if not exists sku               text,
  add column if not exists unit_price        numeric(10, 2),
  add column if not exists stock_status      text,
  add column if not exists stock_qty         integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_parts_source_check') then
    alter table public.project_parts
      add constraint project_parts_source_check check (source in ('catalog', 'to_design'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'project_parts_kind_check') then
    alter table public.project_parts
      add constraint project_parts_kind_check
      check (kind is null or kind in ('mechanical', 'electronics', 'software'));
  end if;
  -- A to-design part always has a kind; a catalog part carries no price rule
  -- beyond what the Store had when it was added.
  if not exists (select 1 from pg_constraint where conname = 'project_parts_design_kind') then
    alter table public.project_parts
      add constraint project_parts_design_kind
      check (source <> 'to_design' or kind is not null) not valid;
  end if;
end $$;

-- Existing rows were all designed parts; their kind follows their process.
update public.project_parts
   set kind = case when process = 'pcb_manufacturing' then 'electronics' else 'mechanical' end
 where source = 'to_design' and kind is null;

alter table public.project_parts validate constraint project_parts_design_kind;
