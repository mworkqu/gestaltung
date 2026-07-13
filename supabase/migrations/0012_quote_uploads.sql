-- ============================================================================
-- Gestaltung — Store-first follow-up: public "request a quote" file uploads
-- ============================================================================
-- Run AFTER 0001_auth_roles_rls.sql (reuses public.is_super_admin()).
--
-- Backs the public /design/quote flow: an anonymous visitor drops a CAD file on
-- the homepage, uploads it straight to Storage from the browser (keeping big
-- files off Vercel's ~4.5 MB request limit), then submits their contact details
-- + chosen method. The owner is emailed a short-lived signed download link that
-- /api/design-quote generates with the service-role key.
--
-- The bucket is PRIVATE. Anyone may upload (public lead capture) but only the
-- super_admin can read/list through RLS; the app itself downloads via signed
-- URLs. Files live under  <uuid>/<filename>.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('quote-uploads', 'quote-uploads', false, 52428800) -- 50 MB
on conflict (id) do nothing;

-- INSERT: open to anyone (public quote submissions), scoped to this bucket.
drop policy if exists quote_uploads_insert on storage.objects;
create policy quote_uploads_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'quote-uploads');

-- SELECT: super_admin only (the app downloads via service-role signed URLs).
drop policy if exists quote_uploads_select on storage.objects;
create policy quote_uploads_select on storage.objects
  for select to authenticated
  using (bucket_id = 'quote-uploads' and public.is_super_admin());

-- DELETE: super_admin only (housekeeping).
drop policy if exists quote_uploads_delete on storage.objects;
create policy quote_uploads_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'quote-uploads' and public.is_super_admin());
