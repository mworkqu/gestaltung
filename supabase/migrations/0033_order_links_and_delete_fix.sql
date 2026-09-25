-- ============================================================================
-- Gestaltung — 0033: projects can be deleted again; brief backfill
--                    (SITE_AUDIT #3/#47 data side, #19 data side,
--                     confirmed project-delete bug)
-- ============================================================================
-- ROLLBACK (manual, run as one transaction):
--   1. Restore the 0024 body of public.log_project_event (section "Triggers"
--      of 0024_project_diagnostics.sql: the `create or replace function
--      public.log_project_event …` statement and its `revoke` line). That
--      brings the delete bug back, so only do it together with reverting
--      whatever needs the old behaviour.
--   2. The brief backfill is not undone automatically: `notes` is left
--      untouched, so every copied brief can be told apart and cleared with
--        update public.projects set brief = null
--         where brief = notes and <the rows you want to revert>;
--      (a project whose brief was written separately and happens to equal its
--      notes cannot be distinguished — there were none when this was written).
--
-- WHAT CHANGES
-- 1. log_project_event (0024) writes nothing when the project no longer
--    exists. Deleting a project cascades to project_parts, whose AFTER DELETE
--    trigger logs 'part_removed' for a project that is already gone; the
--    insert into project_events then failed on project_events_project_id_fkey
--    and the whole delete was rolled back. Any project with parts could not be
--    deleted. Its history goes with it (project_events cascades), so there is
--    nothing to log. Signature, language, security definer, search_path and
--    grants are unchanged.
--
-- 2. create_part_order is NOT changed. The fulfilled marker it writes into
--    projects.bom lines already carries the order id and time
--    ({orderId, at, productId, sku, quantity}) since 0025, and v4 (0032) keeps
--    it. The BOM reads fulfilled.orderId to show "Ordered #… · status".
--
-- 3. Backfill: projects.notes (project page "What are you building?") and
--    projects.brief (prototyping) describe the same thing. The project page
--    moves to `brief`; a project that only has notes gets them copied into
--    brief. `notes` is kept (not dropped). The projects event trigger logs a
--    'brief_edited' event (actor null) for each copied row.
--
-- Run after 0032. Safe to re-run: the backfill only touches empty briefs.
-- ============================================================================

begin;

-- ── 1. log_project_event: no event for a project that is being deleted ─────
create or replace function public.log_project_event(p_project uuid, p_type text, p_detail jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.project_events (project_id, actor, type, detail)
  select p_project, auth.uid(), p_type, coalesce(p_detail, '{}'::jsonb)
   where exists (select 1 from public.projects where id = p_project);
$$;
revoke all on function public.log_project_event(uuid, text, jsonb) from public;

-- ── 3. Backfill brief from notes ─────────────────────────────────────────────
do $$
declare
  v_count integer;
begin
  update public.projects
     set brief = notes
   where (brief is null or btrim(brief) = '')
     and notes is not null and btrim(notes) <> '';
  get diagnostics v_count = row_count;
  raise notice '0033 backfill: % project(s) had notes copied into an empty brief', v_count;
end $$;

do $$ begin raise notice '0033 applied: log_project_event skips deleted projects (project delete fixed); brief backfilled from notes'; end $$;

commit;
