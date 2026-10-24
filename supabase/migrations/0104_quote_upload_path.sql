-- ============================================================================
-- Gestaltung — 0104: quote-uploads accepts only the uploader's path shape
--                    (security audit 2026-10, findings DB-15 / WEB-06 — path only)
-- ============================================================================
-- Problem: the quote-uploads INSERT policy (0012) was
--   with check (bucket_id = 'quote-uploads')
-- so anyone (anon included) could write any object name in the bucket —
-- nested folders, traversal-looking names, names that collide with the shape
-- /api/design-quote signs.
--
-- Now the policy also requires exactly what the browser uploader writes
-- (components/design/quote-request.tsx: `${crypto.randomUUID()}/${sanitize(file.name)}`,
-- sanitize = letters, digits, "." "_" "-"), the same shape
-- lib/design/quote-paths.ts accepts before signing:
--   <uuid>/<1-200 of [A-Za-z0-9._-]>      (case-insensitive, as quote-paths)
-- and no ".." anywhere, and not "." as the file name.
-- The bucket stays private, 50 MB per file (unchanged); MIME types are NOT
-- restricted here (owner decision, see DB-15).
-- A file name longer than 200 characters after sanitize() is now refused at
-- upload (the route already refused to sign such a path).
--
-- RUN AFTER 0099 (and 0100-0103). Safe to re-run (drop policy if exists →
-- create policy; the bucket update is idempotent).
--
-- ROLLBACK (manual): restore the 0012 policy
--   drop policy if exists quote_uploads_insert on storage.objects;
--   create policy quote_uploads_insert on storage.objects
--     for insert to anon, authenticated
--     with check (bucket_id = 'quote-uploads');
-- ============================================================================

update storage.buckets
   set file_size_limit = 52428800 -- 50 MB, as 0012
 where id = 'quote-uploads'
   and file_size_limit is distinct from 52428800;

drop policy if exists quote_uploads_insert on storage.objects;
create policy quote_uploads_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'quote-uploads'
    and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9._-]{1,200}$'
    and position('..' in name) = 0
    and split_part(name, '/', 2) <> '.'
  );

do $$ begin raise notice '0104 applied: quote-uploads insert policy requires <uuid>/<sanitized name>'; end $$;
