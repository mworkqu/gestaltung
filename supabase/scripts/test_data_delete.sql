-- ============================================================================
-- Gestaltung — delete APPROVED test data by id (SITE_AUDIT #7)
-- ============================================================================
-- Needs migration 0031 (is_test columns).
--
-- Deletes ONLY the ids pasted into the four lists below. Nothing is matched
-- by name or pattern here: get the ids from test_data_candidates.sql, check
-- each one, then paste. An empty list is skipped.
--
-- HOW TO RUN
--   1. Paste ids into the lists in step 1: full uuids, single-quoted,
--      comma-separated, NO comma after the last one. Leave a list empty to
--      skip that table.
--   2. Run the whole file with confirm = 'false' (the default). It is a DRY
--      RUN: it does every step, then stops with an error whose message lists
--      how many rows each step touched, and the transaction rolls back.
--      Nothing is changed.
--   3. If a count looks wrong (more rows than ids you pasted, "not found"
--      above 0, a blocker), fix the lists and dry-run again. Do not commit.
--   4. When the counts are right, set confirm to 'true' and run again. The
--      last result is the same count table, and the transaction commits.
--   If anything errors on a real run, the whole transaction rolls back; if
--   you are in psql and the counts look wrong before COMMIT, type ROLLBACK.
--   If the SQL editor then reports an aborted transaction, run `rollback;`
--   on its own.
--
-- ORDER
--   a. Flag every listed row is_test = true first. For projects this also
--      tags their ai_usage rows (0031 trigger), which are KEPT as a cost
--      record but no longer count toward the daily AI guard or the usage page.
--   b. Orders: order lines, then the orders (project_kits.order_id -> null).
--   c. Projects: demand signals and sourcing gaps on them, then their
--      mechanical parts (so the 0024 delete trigger can still log against the
--      project), then the projects. Everything else under a project cascades.
--   d. Parts: demand signals and supplier offers on them, then the parts
--      (cart lines cascade). A part still used by an order line or project
--      item that is NOT in your lists stops the run with its id (ON DELETE
--      RESTRICT): unpublish that product instead.
--   e. Inquiries.
--
-- Protected: any part_orders id whose customer is GESTALTUNG RASHWAN stops the
-- run — those are real orders.
--
-- Not removed: files in Storage buckets (project-images, project files);
-- delete those in the dashboard if you want the space back.
-- ============================================================================

begin;

-- 'false' = dry run (rolls back). 'true' = commit.
select set_config('gestaltung.confirm_delete', 'false', true);

-- ── 1. Paste approved ids here ───────────────────────────────────────────────
create temp table _ids (tbl text not null, id uuid not null, primary key (tbl, id)) on commit drop;

insert into _ids (tbl, id) select 'projects', unnest(array[
  -- 'fdd2a6c7-397f-4ca7-adc5-f4dcbb45dd5f', '…second id…'
]::uuid[]);

insert into _ids (tbl, id) select 'inquiries', unnest(array[
  -- 'id-one', 'id-two'
]::uuid[]);

insert into _ids (tbl, id) select 'part_orders', unnest(array[
  -- the full id of the "TEST ORDER - please delete" order (starts 159b5246)
]::uuid[]);

insert into _ids (tbl, id) select 'parts', unnest(array[
  -- 'id-one', 'id-two'
]::uuid[]);

create temp table _log (seq serial, step text not null, n bigint not null) on commit drop;

-- ── 2. Sanity checks ─────────────────────────────────────────────────────────
insert into _log (step, n)
select 'NOT FOUND (typo?): ' || x.tbl, count(*)
  from _ids x
 where (x.tbl = 'projects'    and not exists (select 1 from public.projects    t where t.id = x.id))
    or (x.tbl = 'inquiries'   and not exists (select 1 from public.inquiries   t where t.id = x.id))
    or (x.tbl = 'part_orders' and not exists (select 1 from public.part_orders t where t.id = x.id))
    or (x.tbl = 'parts'       and not exists (select 1 from public.parts       t where t.id = x.id))
 group by x.tbl;

do $$
begin
  if exists (
    select 1 from public.part_orders o join _ids x on x.tbl = 'part_orders' and x.id = o.id
     where o.customer_name ilike '%rashwan%'
  ) then
    raise exception 'Refusing: a listed part_orders id belongs to GESTALTUNG RASHWAN (a real order). Remove it from the list.';
  end if;
end $$;

-- ── 3a. Flag first ───────────────────────────────────────────────────────────
with u as (update public.projects t set is_test = true from _ids x
            where x.tbl = 'projects' and x.id = t.id returning 1)
insert into _log (step, n) select 'flagged projects', count(*) from u;

with u as (update public.inquiries t set is_test = true from _ids x
            where x.tbl = 'inquiries' and x.id = t.id returning 1)
insert into _log (step, n) select 'flagged inquiries', count(*) from u;

with u as (update public.part_orders t set is_test = true from _ids x
            where x.tbl = 'part_orders' and x.id = t.id returning 1)
insert into _log (step, n) select 'flagged part_orders', count(*) from u;

with u as (update public.parts t set is_test = true from _ids x
            where x.tbl = 'parts' and x.id = t.id returning 1)
insert into _log (step, n) select 'flagged parts', count(*) from u;

insert into _log (step, n)
select 'ai_usage rows now tagged is_test (kept)', count(*)
  from public.ai_usage where project_id in (select id from _ids where tbl = 'projects');

-- ── 3b. Orders ───────────────────────────────────────────────────────────────
with d as (delete from public.part_order_items
            where order_id in (select id from _ids where tbl = 'part_orders') returning 1)
insert into _log (step, n) select 'deleted part_order_items', count(*) from d;

with d as (delete from public.part_orders
            where id in (select id from _ids where tbl = 'part_orders') returning 1)
insert into _log (step, n) select 'deleted part_orders', count(*) from d;

-- ── 3c. Projects ─────────────────────────────────────────────────────────────
with d as (delete from public.demand_signals
            where project_id in (select id from _ids where tbl = 'projects') returning 1)
insert into _log (step, n) select 'deleted demand_signals (projects)', count(*) from d;

with d as (delete from public.sourcing_gaps
            where project_id in (select id from _ids where tbl = 'projects') returning 1)
insert into _log (step, n) select 'deleted sourcing_gaps', count(*) from d;

with d as (delete from public.project_parts
            where project_id in (select id from _ids where tbl = 'projects') returning 1)
insert into _log (step, n) select 'deleted project_parts', count(*) from d;

with d as (delete from public.project_items
            where project_id in (select id from _ids where tbl = 'projects') returning 1)
insert into _log (step, n) select 'deleted project_items', count(*) from d;

with d as (delete from public.projects
            where id in (select id from _ids where tbl = 'projects') returning 1)
insert into _log (step, n) select 'deleted projects (children cascade)', count(*) from d;

-- ── 3d. Parts ────────────────────────────────────────────────────────────────
-- Orders and projects in your lists are gone by now, so anything left here is
-- a REAL order or project still using a listed product.
do $$
declare b text;
begin
  select string_agg(distinct x.part_id::text, ', ') into b
    from (
      select part_id from public.part_order_items where part_id in (select id from _ids where tbl = 'parts')
      union all
      select product_id from public.project_items where product_id in (select id from _ids where tbl = 'parts')
    ) x;
  if b is not null then
    raise exception 'Refusing: these listed parts are still used by orders or projects not in your lists: %. Unpublish them instead, or remove them from the parts list.', b;
  end if;
end $$;

with d as (delete from public.demand_signals
            where part_id in (select id from _ids where tbl = 'parts') returning 1)
insert into _log (step, n) select 'deleted demand_signals (parts)', count(*) from d;

with d as (delete from public.supplier_offers
            where part_id in (select id from _ids where tbl = 'parts') returning 1)
insert into _log (step, n) select 'deleted supplier_offers', count(*) from d;

with d as (delete from public.parts
            where id in (select id from _ids where tbl = 'parts') returning 1)
insert into _log (step, n) select 'deleted parts (cart lines cascade)', count(*) from d;

-- ── 3e. Inquiries ────────────────────────────────────────────────────────────
with d as (delete from public.inquiries
            where id in (select id from _ids where tbl = 'inquiries') returning 1)
insert into _log (step, n) select 'deleted inquiries', count(*) from d;

-- ── 4. Echo counts; stop here unless confirmed ───────────────────────────────
insert into _log (step, n) select 'ids pasted: ' || tbl, count(*) from _ids group by tbl;

do $$
declare s text;
begin
  select string_agg(step || ': ' || n, E'\n' order by seq) into s from _log;
  if coalesce(current_setting('gestaltung.confirm_delete', true), 'false') <> 'true' then
    raise exception E'DRY RUN, rolled back, nothing changed.\n%\nIf every count is right, set confirm_delete to ''true'' and run again.',
      coalesce(s, '(no ids pasted)');
  end if;
  raise notice E'Committing:\n%', s;
end $$;

select step, n from _log order by seq;

-- Counts wrong? In psql type ROLLBACK instead of letting this line run.
commit;
