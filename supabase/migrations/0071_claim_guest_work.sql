-- ============================================================================
-- Gestaltung — 0071: keep a guest's work when they sign in to an existing
--                    account (W1, Studio walkthrough fixes, 2026-10-11)
-- ============================================================================
-- Run AFTER 0070. Safe to re-run: one `create or replace function`, grants
-- re-applied, no table or column is created or altered.
--
-- WHY
-- A guest has a Supabase ANONYMOUS user (lib/supabase/guest.ts). Signing UP
-- upgrades that same user (updateUser keeps auth.uid()), but signing IN to an
-- existing account swaps the session for a different auth.uid(), and the
-- guest's project stayed with the anonymous user and "disappeared".
--
-- WHAT
-- public.claim_guest_work(p_from uuid, p_to uuid) → jsonb. SECURITY DEFINER,
-- EXECUTE for service_role ONLY. It is called by app/api/auth/claim-guest,
-- which first proves BOTH identities: p_from from the guest's anonymous access
-- token (auth.getUser(token), is_anonymous = true) and p_to from the new
-- session cookie (not anonymous), and p_from <> p_to. The function re-checks
-- all of it (p_from anonymous, p_to a real account with a profile).
--
-- Idempotent: every step moves only rows still owned by p_from, so a second
-- call moves nothing and answers ok with zero counts. Concurrent calls for the
-- same guest are serialised with an advisory lock.
--
-- EVERY GUEST-WRITABLE OWNER COLUMN (grep of migrations 0001–0070 for
-- references to auth.users / profiles, `default auth.uid()`, owner_id,
-- client_id, user_id, profile_id, created_by, and storage owner):
--   MOVED to p_to
--   projects.user_id               (0015) the projects; every child table is
--       keyed by project_id only and follows its project unchanged:
--       project_blocks, project_materials, project_items (0015),
--       project_files (0018), project_claims, project_parts,
--       project_schematics(+_revisions) (0020), projects.studio (0068,
--       the Studio doc incl. the last step), project_events (0024)
--       → 3-active limit (0042 projects_enforce_limit): projects are moved
--         newest first; one that would break the limit is moved as
--         'archived' (kept, never lost; the account can re-activate it).
--   cart_items.user_id             (0016/0025) unique line per
--       (user, product, project, kit): a line the account already has keeps
--       the account's row with quantity = the larger of the two and the
--       union of bom_lines; the guest's duplicate is removed; the rest move.
--   client_inventory_items.user_id (0017) one row per (user, catalogue
--       product): a duplicate is added to the account's quantity, then
--       removed; custom items move as they are.
--   project_kits.user_id           (0025)
--   credits_ledger.user_id         (0042) unique purchase grant per
--       (user, kind, reason): a grant the account already has stays with
--       the guest (skipped, never doubled); everything else moves.
--   part_orders.profile_id         (0011) guest orders show under /orders.
--       (Only status updates fire the order triggers; this does not.)
--   cad_generations.user_id        (0043)
--   analysis_runs.user_id          (0024)
--   sourcing_gaps.user_id          (0023)
--   demand_signals.user_id         (0029)
--   storage.objects.owner/owner_id (cad-files print STLs, project images):
--       best effort in its own sub-block; files stay at their paths and stay
--       readable by the project's owner (0045 owns_storage_project).
--   profiles.phone / full_name     copied to the account ONLY when the
--       account's own value is empty (never re-ask an answer).
--   NOT MOVED (on purpose)
--   ai_usage.user_id / anon_key    (0023/0042) the AI meter: moving it would
--       count the guest's calls against the account's rate limit.
--   notification_outbox / notification_prefs (0046) a guest has no email.
--   project_events.actor           history, not ownership.
--   credits_ledger.created_by, restock_receipts.created_by,
--   order_status_history.changed_by, reviews.moderated_by,
--   studio_parts.updated_by        admin-only columns, never a guest.
--   inquiries (0002, print_request / studio_quote leads) has no user column.
-- The anonymous user itself is left in place; once it owns nothing the
-- weekly cleanup (0055 cleanup_anonymous_users) removes it.
--
-- DRY RUN (read-only; how much one guest would move):
--   select (select count(*) from public.projects where user_id = '<guest uuid>') as projects,
--          (select count(*) from public.cart_items where user_id = '<guest uuid>') as cart_lines,
--          (select count(*) from public.part_orders where profile_id = '<guest uuid>') as orders;
--
-- AFTER (checks):
--   select proname, prosecdef from pg_proc where proname = 'claim_guest_work';   -- t
--   -- must FAIL for the browser roles:
--   --   set role authenticated; select public.claim_guest_work(gen_random_uuid(), gen_random_uuid());
--
-- ROLLBACK (manual):
--   drop function if exists public.claim_guest_work(uuid, uuid);
--   (The app then answers run_0071 and shows the "Try again" notice.)
-- ============================================================================

create or replace function public.claim_guest_work(p_from uuid, p_to uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from_anon   boolean;
  v_to_anon     boolean;
  r             record;
  v_projects    integer := 0;
  v_archived    integer := 0;
  v_cart        integer := 0;
  v_cart_merged integer := 0;
  v_inv         integer := 0;
  v_inv_merged  integer := 0;
  v_kits        integer := 0;
  v_credits     integer := 0;
  v_orders      integer := 0;
  v_cad         integer := 0;
  v_runs        integer := 0;
  v_gaps        integer := 0;
  v_signals     integer := 0;
  v_files       integer := 0;
  v_n           integer := 0;
begin
  if p_from is null or p_to is null or p_from = p_to then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select coalesce(u.is_anonymous, false) into v_from_anon from auth.users u where u.id = p_from;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'guest_missing');
  end if;
  if not v_from_anon then
    return jsonb_build_object('ok', false, 'reason', 'not_guest');
  end if;

  select coalesce(u.is_anonymous, false) into v_to_anon from auth.users u where u.id = p_to;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'account_missing');
  end if;
  if v_to_anon then
    return jsonb_build_object('ok', false, 'reason', 'account_is_guest');
  end if;
  if not exists (select 1 from public.profiles where id = p_to) then
    return jsonb_build_object('ok', false, 'reason', 'account_missing');
  end if;

  -- One claim per guest at a time (a double click, two tabs).
  perform pg_advisory_xact_lock(hashtext('claim_guest_work:' || p_from::text));

  -- ── Projects (newest first, so the one just worked on stays active) ──────
  for r in
    select p.id
      from public.projects p
     where p.user_id = p_from
     order by p.updated_at desc nulls last, p.created_at desc
       for update
  loop
    begin
      update public.projects set user_id = p_to where id = r.id;
    exception when raise_exception then
      if sqlerrm <> 'project_limit' then
        raise;
      end if;
      -- Over the 3-active limit: keep it, archived (the limit ignores archived).
      update public.projects set user_id = p_to, status = 'archived' where id = r.id;
      v_archived := v_archived + 1;
    end;
    v_projects := v_projects + 1;
    perform public.log_project_event(r.id, 'project_claimed', jsonb_build_object('via', 'sign_in'));
  end loop;

  -- ── Cart lines ───────────────────────────────────────────────────────────
  update public.cart_items t
     set quantity  = greatest(t.quantity, g.quantity),
         bom_lines = array(select distinct x from unnest(t.bom_lines || g.bom_lines) as x order by x)
    from public.cart_items g
   where g.user_id = p_from
     and t.user_id = p_to
     and t.product_id = g.product_id
     and t.project_id is not distinct from g.project_id
     and t.kit_id is not distinct from g.kit_id;
  get diagnostics v_cart_merged = row_count;

  delete from public.cart_items g
   using public.cart_items t
   where g.user_id = p_from
     and t.user_id = p_to
     and t.product_id = g.product_id
     and t.project_id is not distinct from g.project_id
     and t.kit_id is not distinct from g.kit_id;

  update public.cart_items set user_id = p_to where user_id = p_from;
  get diagnostics v_cart = row_count;

  -- ── Own inventory ────────────────────────────────────────────────────────
  update public.client_inventory_items t
     set quantity = t.quantity + g.quantity
    from public.client_inventory_items g
   where g.user_id = p_from
     and t.user_id = p_to
     and g.product_id is not null
     and t.product_id = g.product_id;
  get diagnostics v_inv_merged = row_count;

  delete from public.client_inventory_items g
   using public.client_inventory_items t
   where g.user_id = p_from
     and t.user_id = p_to
     and g.product_id is not null
     and t.product_id = g.product_id;

  update public.client_inventory_items set user_id = p_to where user_id = p_from;
  get diagnostics v_inv = row_count;

  -- ── Kits, credits, orders, history ───────────────────────────────────────
  update public.project_kits set user_id = p_to where user_id = p_from;
  get diagnostics v_kits = row_count;

  update public.credits_ledger g
     set user_id = p_to
   where g.user_id = p_from
     and not (
       g.reason like 'purchase:%'
       and exists (
         select 1 from public.credits_ledger t
          where t.user_id = p_to and t.kind = g.kind and t.reason = g.reason
       )
     );
  get diagnostics v_credits = row_count;

  update public.part_orders set profile_id = p_to where profile_id = p_from;
  get diagnostics v_orders = row_count;

  update public.cad_generations set user_id = p_to where user_id = p_from;
  get diagnostics v_cad = row_count;

  update public.analysis_runs set user_id = p_to where user_id = p_from;
  get diagnostics v_runs = row_count;

  update public.sourcing_gaps set user_id = p_to where user_id = p_from;
  get diagnostics v_gaps = row_count;

  update public.demand_signals set user_id = p_to where user_id = p_from;
  get diagnostics v_signals = row_count;

  -- ── Profile answers the account does not have yet ────────────────────────
  update public.profiles t
     set phone     = case when coalesce(btrim(t.phone), '') = '' then g.phone else t.phone end,
         full_name = case when coalesce(btrim(t.full_name), '') = '' then g.full_name else t.full_name end
    from public.profiles g
   where t.id = p_to
     and g.id = p_from
     and (
       (coalesce(btrim(t.phone), '') = '' and coalesce(btrim(g.phone), '') <> '')
       or (coalesce(btrim(t.full_name), '') = '' and coalesce(btrim(g.full_name), '') <> '')
     );

  -- ── Stored files (best effort; never blocks the claim) ───────────────────
  begin
    update storage.objects set owner = p_to where owner = p_from;
    get diagnostics v_files = row_count;
  exception when others then
    v_files := -1;
  end;
  begin
    update storage.objects set owner_id = p_to::text where owner_id = p_from::text;
    get diagnostics v_n = row_count;
    if v_files >= 0 then v_files := greatest(v_files, v_n); end if;
  exception when others then
    null; -- older storage schema without owner_id
  end;

  return jsonb_build_object(
    'ok', true,
    'projects', v_projects,
    'archived', v_archived,
    'cart', v_cart,
    'cart_merged', v_cart_merged,
    'inventory', v_inv,
    'inventory_merged', v_inv_merged,
    'kits', v_kits,
    'credits', v_credits,
    'orders', v_orders,
    'cad', v_cad,
    'analysis_runs', v_runs,
    'sourcing_gaps', v_gaps,
    'demand_signals', v_signals,
    'files', v_files
  );
end $$;

revoke all on function public.claim_guest_work(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_guest_work(uuid, uuid) to service_role;

do $$
declare n_fn int;
begin
  select count(*) into n_fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'claim_guest_work' and p.prosecdef;
  if n_fn <> 1 then
    raise exception '0071 incomplete: claim_guest_work security definer functions %/1', n_fn;
  end if;
  if has_function_privilege('authenticated', 'public.claim_guest_work(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.claim_guest_work(uuid, uuid)', 'execute') then
    raise exception '0071: claim_guest_work must be service_role only';
  end if;
  raise notice '0071 applied: claim_guest_work(p_from, p_to) — SECURITY DEFINER, service_role only; moves a guest''s projects (+ children), cart, inventory, kits, credits, orders, CAD/analysis history and file ownership to the signed-in account';
end $$;
