-- ============================================================================
-- Gestaltung — 0049: public `videos` bucket for the self-hosted feature clips
--                    (P3-04 / WF-07 / CC-2)
-- ============================================================================
-- Six short clips (lib/videos.ts) are played from Supabase Storage, never from
-- a third-party embed. Layout, one folder per clip slug:
--
--   videos/<slug>/<slug>.mp4      H.264 + AAC, up to 1280x720
--   videos/<slug>/<slug>.webm     VP9 / AV1 + Opus (same cut)
--   videos/<slug>/<slug>.jpg      poster, 1280x720
--   videos/<slug>/<slug>.en.vtt   English captions
--   videos/<slug>/<slug>.ar.vtt   Arabic captions
--
-- Public read for everyone (the clips are marketing); write / update / delete
-- only for a super admin (scripts/upload-video.mjs uses the service role key,
-- which bypasses these policies anyway). 50 MB per file, four MIME types.
--
-- Run AFTER 0048. Safe to re-run.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos', 'videos', true,
  52428800, -- 50 MB
  array['video/mp4', 'video/webm', 'image/jpeg', 'text/vtt']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['video/mp4', 'video/webm', 'image/jpeg', 'text/vtt'];

drop policy if exists videos_read on storage.objects;
create policy videos_read on storage.objects
  for select to anon, authenticated using (bucket_id = 'videos');

drop policy if exists videos_admin_write on storage.objects;
create policy videos_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'videos' and public.is_super_admin())
  with check (bucket_id = 'videos' and public.is_super_admin());
