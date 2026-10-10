-- ============================================================================
-- Gestaltung — 0062: EDM "from" price + 20 MB drawing-request uploads
-- ============================================================================
-- 1. store_settings.service_prices gets edm_from (QAR 350, OWNER TO CONFIRM),
--    shown on /design/quote as "EDM from QAR 350". Only added when missing, so
--    an owner edit is never overwritten. Until this runs the app uses the same
--    default from lib/pricing/defaults.ts.
-- 2. The private project-images bucket (0015) limit goes from 10 MB to 20 MB so
--    a client can attach a photo, sketch or PDF to a drawing request
--    (/projects/new?for=drawing). Policies are unchanged (owner folder only).
-- Run after 0061. Safe to re-run.
-- ============================================================================

update public.store_settings
   set value = value || '{"edm_from": 350}'::jsonb,
       updated_at = now()
 where key = 'service_prices'
   and not (value ? 'edm_from');

update storage.buckets
   set file_size_limit = 20971520 -- 20 MB
 where id = 'project-images';

do $$ begin raise notice '0062 applied: service_prices.edm_from + project-images 20 MB'; end $$;
