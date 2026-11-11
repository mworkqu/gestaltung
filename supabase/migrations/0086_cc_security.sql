-- 0086_cc_security.sql — CAD Champions pre-launch security fix (Prompt 12 Step A,
-- docs/cad-champions/SECURITY_REVIEW.md finding SR-H1).
--
-- RUN AFTER 0085. Pure RLS tightening: no table, column or data change.
-- Safe to re-run (drop policy if exists + create).
-- NOTE: re-running 0078_cc_storage.sql re-creates the old, open read policies;
-- run 0086 again afterwards.
--
-- What it fixes:
--   0078 let EVERY signed-in user select (and so list and download through the
--   Storage API) every object in two private buckets:
--     - cc-lesson-files: the paid lesson downloads (notes PDFs, part files).
--       A free account could take all paid content without enrolling.
--     - cc-task-files: the drawings/files of EVERY test task, including
--       unpublished and admin-only tests (future mocks) and tests the student
--       has not started.
--   The app never reads these buckets with the student's session: it signs
--   10-minute URLs with the service role AFTER its own access check
--   (lib/cad-champions/training/server.ts signedFileLinks,
--   lib/cad-champions/test/actions.ts createSignedDownload). So reads become
--   staff-only; admin write policies are unchanged.
--
-- Rollback (restores 0078 behaviour):
--   drop policy if exists cc_task_files_read on storage.objects;
--   create policy cc_task_files_read on storage.objects for select to authenticated using (bucket_id = 'cc-task-files');
--   drop policy if exists cc_lesson_files_read on storage.objects;
--   create policy cc_lesson_files_read on storage.objects for select to authenticated using (bucket_id = 'cc-lesson-files');

drop policy if exists cc_task_files_read on storage.objects;
create policy cc_task_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cc-task-files' and public.cc_is_staff());

drop policy if exists cc_lesson_files_read on storage.objects;
create policy cc_lesson_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'cc-lesson-files' and public.cc_is_staff());
