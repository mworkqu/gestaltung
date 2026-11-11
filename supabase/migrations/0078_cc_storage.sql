-- ============================================================================
-- 0078_cc_storage.sql  -  CAD Champions: private storage buckets + policies
-- ============================================================================
-- RUN AFTER 0077 (uses public.cc_is_staff() / public.cc_is_admin()).
--
-- All buckets are PRIVATE (public = false): files are served through
-- short-lived signed URLs created by the server. Path rule: the first folder
-- of every student-owned object is the owner's auth uid.
--
--   cc-task-files      test/exercise briefs, drawings, given part files.
--                      Read: any signed-in user. Write: CC admins. 50 MB.
--                      NEVER put answer files here (students can read it).
--   cc-answer-files    reference/answer STEP files used to build reference_data.
--                      Read: staff. Write: CC admins. 50 MB.
--   cc-lesson-files    lesson downloads. Read: signed-in. Write: admins. 50 MB.
--   cc-submissions     {user_id}/{attempt_id}/{task_id}/{ts}_{name}
--                      (also {user_id}/exercises/... and {user_id}/questions/...).
--                      Read: owner + staff. Insert: owner only into own folder.
--                      Students cannot overwrite or delete (paths carry a
--                      timestamp; "replace" uploads a new object). Admin all. 50 MB.
--   cc-payment-proofs  {user_id}/{payment_id}/{ts}_{name}
--                      Read: owner + CC admins. Insert: owner. Admin all. 10 MB.
--
-- allowed_mime_types is a first line of defence only; server code must also
-- check extension, size and file header (STEP = ISO-10303-21).
-- Browsers often send .step/.stp as application/octet-stream, so it is allowed
-- where STEP uploads are expected.
--
-- Safe to re-run (on conflict do update; drop policy if exists).
-- Rollback (comments):
--   drop policy if exists <each cc_* policy below> on storage.objects;
--   delete from storage.objects where bucket_id like 'cc-%';
--   delete from storage.buckets where id like 'cc-%';
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('cc-task-files', 'cc-task-files', false, 52428800,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
         'application/step', 'model/step', 'application/x-step', 'application/octet-stream',
         'application/zip']),
  ('cc-answer-files', 'cc-answer-files', false, 52428800,
   array['application/step', 'model/step', 'application/x-step', 'application/octet-stream',
         'application/pdf', 'application/zip']),
  ('cc-lesson-files', 'cc-lesson-files', false, 52428800,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
         'application/step', 'model/step', 'application/x-step', 'application/octet-stream',
         'application/zip']),
  ('cc-submissions', 'cc-submissions', false, 52428800,
   array['application/step', 'model/step', 'application/x-step', 'application/octet-stream',
         'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm']),
  ('cc-payment-proofs', 'cc-payment-proofs', false, 10485760,
   array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------ cc-task-files
drop policy if exists cc_task_files_read on storage.objects;
create policy cc_task_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cc-task-files');

drop policy if exists cc_task_files_admin_write on storage.objects;
create policy cc_task_files_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'cc-task-files' and public.cc_is_admin())
  with check (bucket_id = 'cc-task-files' and public.cc_is_admin());

-- ---------------------------------------------------------- cc-answer-files
drop policy if exists cc_answer_files_staff_read on storage.objects;
create policy cc_answer_files_staff_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cc-answer-files' and public.cc_is_staff());

drop policy if exists cc_answer_files_admin_write on storage.objects;
create policy cc_answer_files_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'cc-answer-files' and public.cc_is_admin())
  with check (bucket_id = 'cc-answer-files' and public.cc_is_admin());

-- ---------------------------------------------------------- cc-lesson-files
drop policy if exists cc_lesson_files_read on storage.objects;
create policy cc_lesson_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cc-lesson-files');

drop policy if exists cc_lesson_files_admin_write on storage.objects;
create policy cc_lesson_files_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'cc-lesson-files' and public.cc_is_admin())
  with check (bucket_id = 'cc-lesson-files' and public.cc_is_admin());

-- ----------------------------------------------------------- cc-submissions
drop policy if exists cc_submissions_read on storage.objects;
create policy cc_submissions_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cc-submissions'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.cc_is_staff())
  );

drop policy if exists cc_submissions_insert_own on storage.objects;
create policy cc_submissions_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cc-submissions'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists cc_submissions_admin_all on storage.objects;
create policy cc_submissions_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'cc-submissions' and public.cc_is_admin())
  with check (bucket_id = 'cc-submissions' and public.cc_is_admin());

-- -------------------------------------------------------- cc-payment-proofs
drop policy if exists cc_payment_proofs_read on storage.objects;
create policy cc_payment_proofs_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'cc-payment-proofs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.cc_is_admin())
  );

drop policy if exists cc_payment_proofs_insert_own on storage.objects;
create policy cc_payment_proofs_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cc-payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists cc_payment_proofs_admin_all on storage.objects;
create policy cc_payment_proofs_admin_all on storage.objects
  for all to authenticated
  using (bucket_id = 'cc-payment-proofs' and public.cc_is_admin())
  with check (bucket_id = 'cc-payment-proofs' and public.cc_is_admin());
