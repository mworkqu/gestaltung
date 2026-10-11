-- ============================================================================
-- Gestaltung — 0072: third-party integrations (D6 Videos & YouTube, 2026-10-11)
-- ============================================================================
-- Run AFTER 0071 (does not depend on it). Safe to re-run: create if not exists,
-- RLS re-enabled, grants re-applied; no data is touched.
--
-- ROLLBACK (removes the connected YouTube channel; the owner reconnects later):
--   begin;
--   drop table if exists public.integrations;
--   commit;
--
-- WHAT
-- public.integrations — one row per provider ('youtube' today). Holds the OAuth
-- refresh token ENCRYPTED by the app (AES-256-GCM, key INTEGRATIONS_ENC_KEY,
-- lib/integrations/crypto.ts — the database never sees the plain token) plus a
-- small metadata jsonb: channel id/title, the YouTube API units used today
-- (quota day = Pacific date) and the clips uploaded so far.
--
-- WHO CAN READ IT
-- RLS is ENABLED with NO policies, and every privilege is revoked from anon and
-- authenticated: only the service_role (server routes under
-- app/api/admin/youtube/*, after a super_admin check) reads or writes it. The
-- browser never receives the token, not even encrypted.
-- ============================================================================

begin;

create table if not exists public.integrations (
  provider          text primary key check (provider in ('youtube')),
  refresh_token_enc text,
  scopes            text,
  account_label     text,
  metadata          jsonb not null default '{}'::jsonb,
  connected_by      uuid references auth.users (id) on delete set null,
  connected_at      timestamptz,
  updated_at        timestamptz not null default now()
);

comment on table public.integrations is
  'D6: OAuth connections (YouTube). refresh_token_enc is AES-256-GCM sealed by the app; service_role only (RLS on, no policies).';

alter table public.integrations enable row level security;

revoke all on table public.integrations from public;
revoke all on table public.integrations from anon;
revoke all on table public.integrations from authenticated;
grant select, insert, update, delete on table public.integrations to service_role;

drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at
  before update on public.integrations
  for each row execute function public.set_updated_at();

commit;

-- CHECK (read-only):
--   select provider, account_label, connected_at, metadata->'quota' from public.integrations;
--   -- as anon/authenticated this returns permission denied / no rows.
