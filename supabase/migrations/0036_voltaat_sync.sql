-- ============================================================================
-- Gestaltung — 0036: Voltaat price sync (Part 4, Task 19g)
-- ============================================================================
-- We resell Voltaat products at Voltaat's own retail price (mirror mode) and
-- are paid a commission, so their current price is our price. A daily job
-- reads Voltaat's public Shopify catalogue (products.json, allowed by their
-- robots.txt, one request every 5 seconds, honest user agent) and writes
-- NUMBERS ONLY to the mapped Voltaat offers: retail price, availability,
-- lead time. The existing trigger (0028) then moves a mirror product's price
-- the same moment. Names, descriptions, photos and specifications are never
-- written.
--
-- 1. supplier_sync_runs — one row per run: status, requests made, offers
--    checked/changed, the error when it stopped, and every change
--    (old → new retail, availability, our price after). super_admin reads.
-- 2. store_settings.voltaat_sync = {"enabled": true} — the one-click switch.
--
-- Run after 0035. Safe to re-run.
-- ============================================================================

create table if not exists public.supplier_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  supplier_code text not null,
  trigger       text not null check (trigger in ('cron', 'manual')),
  status        text not null default 'running'
                  check (status in ('running', 'ok', 'blocked', 'failed', 'disabled', 'skipped')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  requests      integer not null default 0,
  checked       integer not null default 0,
  changed       integer not null default 0,
  missing       integer not null default 0,
  error         text,
  changes       jsonb not null default '[]'::jsonb
);

create index if not exists supplier_sync_runs_recent_idx on public.supplier_sync_runs (supplier_code, started_at desc);

alter table public.supplier_sync_runs enable row level security;
grant select on public.supplier_sync_runs to authenticated;
drop policy if exists supplier_sync_runs_admin_select on public.supplier_sync_runs;
create policy supplier_sync_runs_admin_select on public.supplier_sync_runs
  for select to authenticated using (public.is_super_admin());

insert into public.store_settings (key, value) values ('voltaat_sync', '{"enabled": true}'::jsonb)
on conflict (key) do nothing;

-- Voltaat sells in QAR (checked on their store 2026-09-28).
update public.suppliers set default_currency = 'QAR', default_pricing_mode = 'mirror', website = 'https://www.voltaat.com'
 where code = 'voltaat';

do $$ begin raise notice '0036 applied: supplier_sync_runs, voltaat_sync switch'; end $$;
