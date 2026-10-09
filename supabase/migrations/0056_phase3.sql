-- ============================================================================
-- Gestaltung — 0056: Phase 3 settings (site_v2 flag + occasions)
--                    (P3-03 and Phase 3 groups, 2026-10-09)
-- ============================================================================
-- RUN AFTER 0055. Safe to re-run: every settings row is inserted with
-- `on conflict (key) do nothing` (the owner's values survive a re-run).
--
-- WHAT CHANGES
-- 1. store_settings.site_v2 = {"enabled": false}. The switch for the rebuilt
--    public pages under app/[locale]/v2 (plan §5.4). Read by middleware.ts
--    (lib/site-v2.ts) with the anon key, cached 60 s per server instance.
--      OFF (default): the public URLs serve the current pages; /en/v2… and
--        /ar/v2… answer 404 unless the browser carries the preview cookie
--        site_v2=1 (GET /api/admin/site-v2-preview, super_admin only).
--      ON: /, /how-it-works, /design and /store (without listing params such
--        as ?q=) render the v2 pages under the SAME public URL; /…/v2… 308s
--        back to the public URL.
--    Only an exact {"enabled": true} is ON; anything else (missing row, other
--    JSON, fetch error, timeout) is OFF.
-- 2. store_settings.occasions = a JSON array of seasonal store campaigns:
--      {id, title_en, title_ar, start, end, query, skus, banner_en, banner_ar}
--    * start / end: "MM-DD" (month-day) repeats EVERY year, inclusive. A range
--      may wrap the new year (start "12-20", end "01-05"). A value WITH a year,
--      "YYYY-MM-DD", applies only in that year (use it for moving dates such
--      as Ramadan / Eid, which the owner edits every year).
--    * query: a store search string, used as /store?q=<query>.
--    * skus: optional explicit list of product SKUs; when non-empty it WINS
--      over query.
--    * banner_en / banner_ar: one short line (<= 90 characters).
--    THE DATES BELOW ARE DEFAULTS — OWNER TO CONFIRM. ramadan-eid carries
--    2027 placeholder dates (Ramadan ~8 Feb, Eid al-Fitr ~10 Mar 2027,
--    moon-sighting dependent) — OWNER EDITS EVERY YEAR.
--
-- RLS: nothing to change. store_settings_select (0025) is
--   `for select to anon, authenticated using (true)` with
--   `grant select ... to anon, authenticated` — anon already reads EVERY key,
--   including these two. Writes stay super_admin only (store_settings_write).
--
-- UNTIL THIS RUNS: the flag reads as OFF (no row = OFF), so the site behaves
-- exactly as today and /…/v2… stays a 404 except with the preview cookie;
-- occasions read as an empty list (no seasonal banner).
--
-- DRY RUN (read-only; run in the SQL editor BEFORE applying):
--   select key, value from public.store_settings where key in ('site_v2', 'occasions');
--
-- AFTER (checks):
--   select key, value from public.store_settings where key in ('site_v2', 'occasions');
--   select jsonb_array_length(value) from public.store_settings where key = 'occasions';  -- 4
--   -- anon can read the flag (what the middleware does):
--   --   set role anon; select value from public.store_settings where key = 'site_v2'; reset role;
--
-- FLIP / ROLLBACK (the switch; takes effect within ~60 s, no deploy):
--   update public.store_settings set value = '{"enabled": true}'::jsonb  where key = 'site_v2';  -- ON
--   update public.store_settings set value = '{"enabled": false}'::jsonb where key = 'site_v2';  -- OFF
--
-- ROLLBACK (manual, removes the rows):
--   delete from public.store_settings where key in ('site_v2', 'occasions');
--   (With the site_v2 row gone the middleware reads the flag as OFF.)
-- ============================================================================

-- ── 1. site_v2 flag (OFF) ───────────────────────────────────────────────────
insert into public.store_settings (key, value)
values ('site_v2', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

-- ── 2. Occasions (dates = defaults, owner to confirm) ───────────────────────
insert into public.store_settings (key, value)
values ('occasions', $json$[
  {
    "id": "science-fair",
    "title_en": "Science fair season",
    "title_ar": "موسم معارض العلوم",
    "start": "02-01",
    "end": "03-31",
    "query": "arduino kit",
    "skus": [],
    "banner_en": "Science fair season: Arduino kits and sensors for your project.",
    "banner_ar": "موسم معارض العلوم: مجموعات Arduino والمستشعرات لمشروعك."
  },
  {
    "id": "exam-season",
    "title_en": "Finish your project",
    "title_ar": "أكمل مشروعك",
    "start": "05-01",
    "end": "06-30",
    "query": "sensor",
    "skus": [],
    "banner_en": "Exam season: the sensors and parts you need to finish your project.",
    "banner_ar": "موسم الامتحانات: المستشعرات والقطع التي تحتاجها لإكمال مشروعك."
  },
  {
    "id": "ramadan-eid",
    "title_en": "Ramadan and Eid",
    "title_ar": "رمضان والعيد",
    "start": "2027-02-08",
    "end": "2027-03-12",
    "query": "led strip",
    "skus": [],
    "banner_en": "Ramadan and Eid: LED strips and lighting parts for your builds.",
    "banner_ar": "رمضان والعيد: شرائط LED وقطع الإضاءة لمشاريعك."
  },
  {
    "id": "national-day",
    "title_en": "Qatar National Day",
    "title_ar": "اليوم الوطني لقطر",
    "start": "12-10",
    "end": "12-18",
    "query": "led",
    "skus": [],
    "banner_en": "Qatar National Day: LED parts for maroon and white builds.",
    "banner_ar": "اليوم الوطني لقطر: قطع LED لمشاريع باللونين العنابي والأبيض."
  }
]$json$::jsonb)
on conflict (key) do nothing;

do $$ begin raise notice '0056 (P3-03) applied: store_settings.site_v2 (off), store_settings.occasions (4 defaults)'; end $$;

-- (0056 was RUN by the owner 2026-10-09. Later Phase 3 SQL, e.g. the P3-06
--  co_purchased RPC, lives in 0057 — never append here.)
