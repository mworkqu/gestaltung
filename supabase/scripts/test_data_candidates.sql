-- ============================================================================
-- Gestaltung — test-data CANDIDATES (read-only; SITE_AUDIT #7)
-- ============================================================================
-- Lists rows that LOOK like test data. It changes nothing: every statement is
-- a plain SELECT (no INSERT / UPDATE / DELETE / DDL anywhere in this file).
--
-- Nothing is deleted by pattern. Read the lists, copy the ids you approve into
-- supabase/scripts/test_data_delete.sql, and run that separately.
--
-- Rules (case-insensitive; a row shows every rule it matched):
--   word_test      the word "test" on its own: "TEST — Plant monitor",
--                  "TEST-SERVO-5V", "QA test". Not "testing", not "Gestaltung".
--   qa_test        "QA test"
--   please_ignore  "please ignore"
--   delete_me      "delete me"
--   please_delete  "please delete"
--   phone_zeros    phone 00000000 / 0000 0000 (with or without +974)
--   example_email  an @example.com address (row email, or the project owner's)
--   sku_123        parts.sku = '123'
--   sku_test       parts.sku starting TEST-
--   exact_name     project named exactly "1" or "product"
--
-- Real orders from "GESTALTUNG RASHWAN" must stay: check the part_orders list
-- by eye before copying any id.
--
-- Supabase SQL editor shows only the LAST result. Highlight one query and run
-- the selection to see that table's list; run the whole file for the summary
-- (it is deliberately the last statement). In psql every result is shown.
-- ============================================================================

-- ── 1. projects ──────────────────────────────────────────────────────────────
with rules(rule, re) as (values
  ('word_test', '\mtest\M'), ('qa_test', 'qa test'), ('please_ignore', 'please ignore'),
  ('delete_me', 'delete me'), ('please_delete', 'please delete'))
select p.id, p.name as display_name, p.created_at,
       string_agg(distinct m.rule, ', ') as matched_rule,
       u.email as owner_email
  from public.projects p
  left join auth.users u on u.id = p.user_id
  cross join lateral (
    select r.rule from rules r where p.name ~* r.re
    union all select 'exact_name' where lower(btrim(p.name)) in ('1', 'product')
    union all select 'example_email' where u.email ilike '%@example.com'
  ) m
 group by p.id, p.name, p.created_at, u.email
 order by p.created_at;

-- ── 2. inquiries (leads) ─────────────────────────────────────────────────────
with rules(rule, re) as (values
  ('word_test', '\mtest\M'), ('qa_test', 'qa test'), ('please_ignore', 'please ignore'),
  ('delete_me', 'delete me'), ('please_delete', 'please delete'))
select i.id, i.name as display_name, i.created_at,
       string_agg(distinct m.rule, ', ') as matched_rule,
       i.phone, i.email, left(i.message, 80) as message_start
  from public.inquiries i
  cross join lateral (
    select r.rule from rules r where (i.name || ' ' || i.message) ~* r.re
    union all select 'phone_zeros' where regexp_replace(i.phone, '[^0-9]', '', 'g') in ('00000000', '97400000000')
    union all select 'example_email' where i.email ilike '%@example.com'
  ) m
 group by i.id, i.name, i.created_at, i.phone, i.email, i.message
 order by i.created_at;

-- ── 3. part_orders ───────────────────────────────────────────────────────────
with rules(rule, re) as (values
  ('word_test', '\mtest\M'), ('qa_test', 'qa test'), ('please_ignore', 'please ignore'),
  ('delete_me', 'delete me'), ('please_delete', 'please delete'))
select o.id, o.customer_name as display_name, o.created_at,
       string_agg(distinct m.rule, ', ') as matched_rule,
       o.customer_phone, o.customer_email, o.status, o.total_qar,
       left(o.delivery_notes, 80) as notes_start
  from public.part_orders o
  cross join lateral (
    select r.rule from rules r
     where (o.customer_name || ' ' || coalesce(o.delivery_notes, '') || ' ' || o.delivery_area) ~* r.re
    union all select 'phone_zeros' where regexp_replace(o.customer_phone, '[^0-9]', '', 'g') in ('00000000', '97400000000')
    union all select 'example_email' where o.customer_email ilike '%@example.com'
  ) m
 group by o.id, o.customer_name, o.created_at, o.customer_phone, o.customer_email, o.status, o.total_qar, o.delivery_notes
 order by o.created_at;

-- ── 4. parts (store products) ────────────────────────────────────────────────
-- in_orders / in_projects: rows that block deleting the product
-- (part_order_items and project_items are ON DELETE RESTRICT). If a REAL
-- order or project uses it, unpublish it instead of deleting it.
with rules(rule, re) as (values
  ('word_test', '\mtest\M'), ('qa_test', 'qa test'), ('please_ignore', 'please ignore'),
  ('delete_me', 'delete me'), ('please_delete', 'please delete'))
select pt.id, pt.name as display_name, pt.created_at,
       string_agg(distinct m.rule, ', ') as matched_rule,
       pt.sku, pt.is_published,
       (select count(*) from public.part_order_items oi where oi.part_id = pt.id) as in_orders,
       (select count(*) from public.project_items pi where pi.product_id = pt.id) as in_projects
  from public.parts pt
  cross join lateral (
    select r.rule from rules r where pt.name ~* r.re
    union all select 'sku_123'  where btrim(pt.sku) = '123'
    union all select 'sku_test' where pt.sku like 'TEST-%'
  ) m
 group by pt.id, pt.name, pt.created_at, pt.sku, pt.is_published
 order by pt.created_at;

-- ── 5. Summary: candidates per table, and what hangs off them ────────────────
with rules(rule, re) as (values
  ('word_test', '\mtest\M'), ('qa_test', 'qa test'), ('please_ignore', 'please ignore'),
  ('delete_me', 'delete me'), ('please_delete', 'please delete')),
c_projects as (
  select p.id from public.projects p left join auth.users u on u.id = p.user_id
   where exists (select 1 from rules r where p.name ~* r.re)
      or lower(btrim(p.name)) in ('1', 'product')
      or u.email ilike '%@example.com'),
c_inquiries as (
  select i.id from public.inquiries i
   where exists (select 1 from rules r where (i.name || ' ' || i.message) ~* r.re)
      or regexp_replace(i.phone, '[^0-9]', '', 'g') in ('00000000', '97400000000')
      or i.email ilike '%@example.com'),
c_orders as (
  select o.id from public.part_orders o
   where exists (select 1 from rules r
                  where (o.customer_name || ' ' || coalesce(o.delivery_notes, '') || ' ' || o.delivery_area) ~* r.re)
      or regexp_replace(o.customer_phone, '[^0-9]', '', 'g') in ('00000000', '97400000000')
      or o.customer_email ilike '%@example.com'),
c_parts as (
  select pt.id from public.parts pt
   where exists (select 1 from rules r where pt.name ~* r.re)
      or btrim(pt.sku) = '123' or pt.sku like 'TEST-%')
select 'projects' as table_name, count(*) as candidates, 'candidate rows' as note from c_projects
union all select 'inquiries', count(*), 'candidate rows' from c_inquiries
union all select 'part_orders', count(*), 'candidate rows' from c_orders
union all select 'parts', count(*), 'candidate rows' from c_parts
union all select 'part_order_items', count(*), 'lines on candidate orders'
  from public.part_order_items where order_id in (select id from c_orders)
union all select 'sourcing_gaps', count(*), 'gaps from candidate projects'
  from public.sourcing_gaps where project_id in (select id from c_projects)
union all select 'demand_signals', count(*), 'signals on candidate projects or parts'
  from public.demand_signals
 where project_id in (select id from c_projects) or part_id in (select id from c_parts)
union all select 'ai_usage', count(*), 'AI calls on candidate projects (kept, tagged is_test)'
  from public.ai_usage where project_id in (select id from c_projects)
union all select 'part_order_items', count(*), 'BLOCKER: candidate parts on non-candidate orders'
  from public.part_order_items
 where part_id in (select id from c_parts) and order_id not in (select id from c_orders)
union all select 'project_items', count(*), 'BLOCKER: candidate parts in non-candidate projects'
  from public.project_items
 where product_id in (select id from c_parts) and project_id not in (select id from c_projects);
