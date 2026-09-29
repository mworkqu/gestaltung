-- ============================================================================
-- Gestaltung — 0041: datasheets, specs and backup products (owner, 2026-09-29)
-- ============================================================================
-- * parts.datasheet_url — the manufacturer's datasheet (from DigiKey / Mouser).
-- * parts.specs         — the supplier's specification table, as
--                         [{ "name": "Voltage - Supply", "value": "2.7V ~ 5.5V" }, …].
--                         Shown on the product page; never guessed by AI.
-- * parts.backup_for    — a DigiKey / Mouser product added because a Voltaat
--                         product is out of stock. The Voltaat product is hidden
--                         while it has no stock; when Voltaat restocks, the
--                         sourcing dashboard asks which one to keep.
--
-- Until this runs the backup search and the spec table do nothing.
-- Run after 0040. Safe to re-run.
-- ============================================================================

alter table public.parts add column if not exists datasheet_url text;
alter table public.parts add column if not exists specs jsonb;
alter table public.parts add column if not exists backup_for uuid references public.parts (id) on delete set null;

create index if not exists parts_backup_for_idx on public.parts (backup_for) where backup_for is not null;

do $$ begin raise notice '0041 applied: parts.datasheet_url, parts.specs, parts.backup_for'; end $$;
