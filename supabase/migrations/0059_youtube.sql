-- ============================================================================
-- Gestaltung — 0059: YouTube links (P4-05, WF-36)
-- ============================================================================
-- RUN AFTER 0058. Safe to re-run: the settings row is inserted with
-- `on conflict (key) do nothing` (the owner's values survive a re-run).
--
-- WHAT CHANGES
-- store_settings.youtube = {"channel_url": "", "videos": []}
--   * channel_url: https://www.youtube.com/@handle (or /channel/…); empty = none.
--   * videos: up to 12 of {id, title_en, title_ar, kit_query}
--       id         the 11-character YouTube video id
--       title_*    shown on the site in the visitor's language
--       kit_query  optional store search words for a "Get the parts" link
--                  (/store?q=<kit_query>); empty = no parts link
--   The site only LINKS to YouTube (no embed, no YouTube script, no
--   thumbnails). Nothing shows on the site until the owner adds a channel or a
--   video in Dashboard → Store → YouTube links.
--
-- RLS: nothing to change. store_settings_select (0025) is
--   `for select to anon, authenticated using (true)` with
--   `grant select ... to anon, authenticated` — anon already reads EVERY key,
--   including this one. Writes stay super_admin only (store_settings_write).
--
-- UNTIL THIS RUNS: the editor's first save creates the row anyway (the table
-- exists), and the public read treats a missing row as "no YouTube links".
--
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   select key, value from public.store_settings where key = 'youtube';
--
-- AFTER (check):
--   select key, value from public.store_settings where key = 'youtube';
--
-- ROLLBACK (manual, removes the row; the site then shows no YouTube section):
--   delete from public.store_settings where key = 'youtube';
-- ============================================================================

insert into public.store_settings (key, value)
values ('youtube', '{"channel_url": "", "videos": []}'::jsonb)
on conflict (key) do nothing;
