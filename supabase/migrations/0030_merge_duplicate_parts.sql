-- ============================================================================
-- Gestaltung — 0030: merge duplicate store products, normalise material,
--                    and stop duplicates coming back (SITE_AUDIT #7)
-- ============================================================================
-- The live catalogue held ten products about ten times each under different
-- SKUs (Diode 1N4148 as GR-024, GR-034 ... GR-114), because the owner's sheet
-- had the duplicate rows and the import upserts by SKU. This migration:
--
-- 1. parts.name_key — the product name lower-cased, ASCII punctuation (and
--    Unicode dashes/quotes) turned into spaces, whitespace collapsed.
--    Maintained by the trigger parts_normalise (so every write path — admin
--    form, quick entry, sheet import — gets it). TypeScript twin:
--    lib/parts/part-key.ts.
-- 2. parts.material normalised to lower snake_case ('Aluminum' → 'aluminum',
--    'Stainless Steel' → 'stainless_steel'), the convention from 0011, by the
--    same trigger.
-- 3. Duplicates merged. A group is (name_key, material, pack_size) over
--    published AND unpublished rows. The survivor is the lowest SKU in natural
--    order (letters, then the first number numerically: GR-024 < GR-114).
--    Every reference is repointed to the survivor:
--      part_order_items.part_id, project_items.product_id,
--      cart_items.product_id, client_inventory_items.product_id,
--      project_parts.catalog_part_id (+ its sku snapshot),
--      supplier_offers.part_id (+ pinned offer), demand_signals.part_id,
--      projects.bom lines[].choice and lines[].fulfilled.productId/sku.
--    Where repointing would break a unique rule (project_items,
--    cart_items, client_inventory_items) the rows are MERGED: quantities
--    summed, the earliest-created row kept, the others deleted.
--    A supplier offer that would collide with one the survivor already has
--    (same supplier + supplier SKU) stays on the merged row.
--    The survivor keeps its own data; empty attributes / tags / images /
--    Arabic name / descriptions / standard / image are filled from the
--    richest duplicate, and it stays published if any copy was published.
--    Duplicates are SOFT-deleted: is_published = false, merged_into = survivor
--    (never published again: the trigger forces it). Deleting a survivor later
--    deletes its merged rows too (merged_into is ON DELETE CASCADE).
-- 4. Unique index parts_name_key_uniq on (name_key, material, pack_size)
--    where merged_into is null, so it cannot recur.
--
-- Run after 0029. Safe to re-run: a second run finds no new groups and only
-- repoints references that still point at a merged row.
-- Ends with notices: groups merged and rows repointed per table.
--
-- ============================================================================
-- (i) DRY RUN — run this ON ITS OWN, BEFORE the migration. Read-only.
--     One result table: each duplicate group with its survivor and the SKUs
--     that will be merged into it, then how many rows each table will have
--     repointed. (It inlines the same normalisation as the migration.)
-- ----------------------------------------------------------------------------
-- with p as (
--   select id, sku, name, is_published, unit_price, created_at,
--          nullif(btrim(regexp_replace(regexp_replace(lower(name),
--            '[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212]', ' ', 'g'),
--            '[\s\u00a0]+', ' ', 'g')), '') as name_key,
--          coalesce(nullif(btrim(regexp_replace(lower(coalesce(material, '')),
--            '[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212\s\u00a0]+', '_', 'g'), '_'), ''), '') as mat,
--          coalesce(pack_size, 1) as pack
--   from public.parts
-- ), r as (
--   select p.*,
--          first_value(id)  over w as survivor_id,
--          first_value(sku) over w as survivor_sku,
--          count(*) over (partition by name_key, mat, pack) as n
--   from p
--   where name_key is not null
--   window w as (partition by name_key, mat, pack
--                order by upper(substring(sku from '^[^0-9]*')) collate "C",
--                         substring(sku from '[0-9]+')::numeric nulls last,
--                         sku collate "C", created_at, id)
-- ), l as (select * from r where n > 1 and id <> survivor_id)
-- select * from (
--   select 1 as ord, 'merge group' as section,
--          name_key || ' | ' || coalesce(nullif(mat, ''), '-') || ' | pack ' || pack as detail,
--          survivor_sku,
--          string_agg(sku, ', ' order by upper(substring(sku from '^[^0-9]*')) collate "C",
--                     substring(sku from '[0-9]+')::numeric nulls last, sku collate "C")
--            filter (where id <> survivor_id) as losing_skus,
--          count(*) - 1 as rows,
--          count(distinct unit_price) as distinct_prices
--   from r where n > 1 group by name_key, mat, pack, survivor_sku
--   union all select 2, 'will repoint', 'part_order_items',       null, null, (select count(*) from public.part_order_items       where part_id         in (select id from l)), null
--   union all select 2, 'will repoint', 'project_items',          null, null, (select count(*) from public.project_items          where product_id      in (select id from l)), null
--   union all select 2, 'will repoint', 'cart_items',             null, null, (select count(*) from public.cart_items             where product_id      in (select id from l)), null
--   union all select 2, 'will repoint', 'client_inventory_items', null, null, (select count(*) from public.client_inventory_items where product_id      in (select id from l)), null
--   union all select 2, 'will repoint', 'project_parts',          null, null, (select count(*) from public.project_parts          where catalog_part_id in (select id from l)), null
--   union all select 2, 'will repoint', 'supplier_offers',        null, null, (select count(*) from public.supplier_offers        where part_id         in (select id from l)), null
--   union all select 2, 'will repoint', 'demand_signals',         null, null, (select count(*) from public.demand_signals         where part_id         in (select id from l)), null
--   union all select 2, 'will repoint', 'projects.bom',           null, null, (select count(*) from public.projects pr
--              where jsonb_typeof(pr.bom -> 'lines') = 'array'
--                and exists (select 1 from jsonb_array_elements(pr.bom -> 'lines') x
--                            where x ->> 'choice' in (select id::text from l)
--                               or x -> 'fulfilled' ->> 'productId' in (select id::text from l))), null
--   union all select 3, 'material will change', 'parts.material', null, null,
--              (select count(*) from public.parts
--               where material is distinct from nullif(btrim(regexp_replace(lower(coalesce(material, '')),
--                 '[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212\s\u00a0]+', '_', 'g'), '_'), '')), null
-- ) d
-- order by ord, detail;
--
-- Check each group before going on: same name but a different spec (e.g. a
-- different tolerance kept only in attributes) WILL be merged. distinct_prices
-- > 1 means the copies disagree on price; the survivor's price is kept.
--
-- ============================================================================
-- (ii) BACKUP — run ON ITS OWN, right before the migration. Copies go to a
--      private schema the website API cannot reach (tables created in
--      `public` would be readable through Supabase's API, and these hold
--      customers' carts and inventories).
-- ----------------------------------------------------------------------------
-- create schema if not exists private_backup;
-- revoke all on schema private_backup from public, anon, authenticated;
-- create table private_backup.parts_backup_0030                  as select * from public.parts;
-- create table private_backup.part_order_items_backup_0030       as select * from public.part_order_items;
-- create table private_backup.project_items_backup_0030          as select * from public.project_items;
-- create table private_backup.cart_items_backup_0030             as select * from public.cart_items;
-- create table private_backup.client_inventory_items_backup_0030 as select * from public.client_inventory_items;
-- create table private_backup.project_parts_backup_0030          as select * from public.project_parts;
-- create table private_backup.supplier_offers_backup_0030        as select * from public.supplier_offers;
-- create table private_backup.demand_signals_backup_0030         as select * from public.demand_signals;
-- create table private_backup.projects_bom_backup_0030           as select id, bom from public.projects;
--
-- ============================================================================
-- (iii) ROLLBACK — restores from the backup above and removes what 0030 added.
--       Run soon after the migration: carts / project items created in
--       between for the same product are kept where they do not collide.
-- ----------------------------------------------------------------------------
-- begin;
-- drop index if exists public.parts_name_key_uniq;
-- drop trigger if exists parts_normalise on public.parts;
-- -- merged rows were deleted from these three: put the originals back
-- delete from public.project_items          where id in (select id from private_backup.project_items_backup_0030);
-- insert into public.project_items          select * from private_backup.project_items_backup_0030 on conflict do nothing;
-- delete from public.cart_items             where id in (select id from private_backup.cart_items_backup_0030);
-- insert into public.cart_items             select * from private_backup.cart_items_backup_0030 on conflict do nothing;
-- delete from public.client_inventory_items where id in (select id from private_backup.client_inventory_items_backup_0030);
-- insert into public.client_inventory_items select * from private_backup.client_inventory_items_backup_0030 on conflict do nothing;
-- -- plain repoints: put the old ids back
-- update public.part_order_items t set part_id = b.part_id
--   from private_backup.part_order_items_backup_0030 b where t.id = b.id and t.part_id is distinct from b.part_id;
-- update public.project_parts t set catalog_part_id = b.catalog_part_id, sku = b.sku, inventory_item_id = b.inventory_item_id
--   from private_backup.project_parts_backup_0030 b where t.id = b.id
--    and (t.catalog_part_id, t.sku, t.inventory_item_id) is distinct from (b.catalog_part_id, b.sku, b.inventory_item_id);
-- update public.supplier_offers t set part_id = b.part_id
--   from private_backup.supplier_offers_backup_0030 b where t.id = b.id and t.part_id is distinct from b.part_id;
-- update public.demand_signals t set part_id = b.part_id
--   from private_backup.demand_signals_backup_0030 b where t.id = b.id and t.part_id is distinct from b.part_id;
-- update public.projects t set bom = b.bom
--   from private_backup.projects_bom_backup_0030 b where t.id = b.id and t.bom is distinct from b.bom;
-- -- the products themselves (material casing, publish state, filled-in fields, pins)
-- update public.parts t set material = b.material, is_published = b.is_published, attributes = b.attributes,
--        tags = b.tags, images = b.images, image_url = b.image_url, name_ar = b.name_ar,
--        description = b.description, description_ar = b.description_ar, standard = b.standard,
--        pinned_offer_id = b.pinned_offer_id
--   from private_backup.parts_backup_0030 b where t.id = b.id;
-- alter table public.parts drop constraint if exists parts_merged_into_not_self;
-- alter table public.parts drop column if exists merged_into;
-- alter table public.parts drop column if exists name_key;
-- drop function if exists public.parts_normalise_trg();
-- drop function if exists public.part_name_key(text);
-- drop function if exists public.part_material_key(text);
-- drop function if exists public.part_merged_redirect_sku(text);
-- commit;
-- -- once happy: drop schema private_backup cascade;
-- ============================================================================

begin;

-- ── 1. Normalisation functions (twins of lib/parts/part-key.ts) ─────────────
create or replace function public.part_name_key(p_name text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(btrim(regexp_replace(
           regexp_replace(lower(coalesce(p_name, '')),
             '[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212]', ' ', 'g'),
           '[\s\u00a0]+', ' ', 'g')), '');
$$;

create or replace function public.part_material_key(p_material text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p_material, '')),
           '[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u2010-\u2015\u2018-\u201f\u2026\u2212\s\u00a0]+', '_', 'g'),
         '_'), '');
$$;

-- ── 2. Columns ───────────────────────────────────────────────────────────────
alter table public.parts
  add column if not exists name_key    text,
  add column if not exists merged_into uuid;

-- merged_into → parts(id) ON DELETE CASCADE: deleting a survivor deletes the
-- rows merged into it. (SET NULL would turn them back into live duplicates and
-- trip parts_name_key_uniq, so the delete would fail.) Re-created if an older
-- draft of this migration left a different ON DELETE rule.
do $$
begin
  if exists (select 1 from pg_constraint
             where conname = 'parts_merged_into_fkey' and conrelid = 'public.parts'::regclass
               and confdeltype <> 'c') then
    alter table public.parts drop constraint parts_merged_into_fkey;
  end if;
  if not exists (select 1 from pg_constraint
                 where conname = 'parts_merged_into_fkey' and conrelid = 'public.parts'::regclass) then
    alter table public.parts add constraint parts_merged_into_fkey
      foreign key (merged_into) references public.parts (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'parts_merged_into_not_self') then
    alter table public.parts add constraint parts_merged_into_not_self check (merged_into is null or merged_into <> id);
  end if;
end $$;

create index if not exists parts_merged_into_idx on public.parts (merged_into) where merged_into is not null;

comment on column public.parts.name_key is
  'Normalised name (public.part_name_key). With material and pack_size, unique among unmerged products (0030).';
comment on column public.parts.merged_into is
  'Set when this row was a duplicate merged into another product (0030). Never published again.';

-- ── 3. Trigger: keep name_key + material normalised, merged rows hidden ─────
create or replace function public.parts_normalise_trg()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.name_key := public.part_name_key(new.name);
  new.material := public.part_material_key(new.material);
  if new.merged_into is not null then
    new.is_published := false;
  end if;
  return new;
end $$;

drop trigger if exists parts_normalise on public.parts;
create trigger parts_normalise
  before insert or update on public.parts
  for each row execute function public.parts_normalise_trg();

-- ── 3b. Old-SKU redirect for the public store ───────────────────────────────
-- /store/<merged sku> should land on the surviving product, but merged rows
-- are unpublished and RLS hides them from visitors. This returns only the
-- SKU of the final PUBLISHED survivor (something visitors can already see),
-- or null. Follows chains (a survivor merged again later).
create or replace function public.part_merged_redirect_sku(p_sku text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select p.merged_into as target, 1 as depth
    from public.parts p
    where p.sku = p_sku and p.merged_into is not null
    union all
    select p.merged_into, c.depth + 1
    from chain c join public.parts p on p.id = c.target
    where p.merged_into is not null and c.depth < 20
  )
  select s.sku
  from chain c join public.parts s on s.id = c.target
  where s.merged_into is null and s.is_published
  limit 1;
$$;

revoke all on function public.part_merged_redirect_sku(text) from public;
grant execute on function public.part_merged_redirect_sku(text) to anon, authenticated;

-- ── 4. Backfill + merge ──────────────────────────────────────────────────────
drop table if exists pg_temp._m0030_stats;
create temp table _m0030_stats (ord int, k text, n bigint);

do $$
declare
  n bigint;
begin
  -- 4a. Backfill name_key; normalise material casing.
  select count(*) into n from public.parts where material is distinct from public.part_material_key(material);
  insert into _m0030_stats values (1, 'parts.material normalised', n);

  update public.parts
     set name_key = public.part_name_key(name), material = public.part_material_key(material)
   where name_key is distinct from public.part_name_key(name)
      or material is distinct from public.part_material_key(material);

  -- 4b. New duplicate groups among products that are not merged yet.
  drop table if exists pg_temp._m0030_new;
  create temp table _m0030_new as
  with ranked as (
    select id,
           first_value(id) over w as survivor,
           count(*) over (partition by name_key, coalesce(material, ''), coalesce(pack_size, 1)) as group_size
    from public.parts
    where merged_into is null and name_key is not null
    window w as (partition by name_key, coalesce(material, ''), coalesce(pack_size, 1)
                 order by upper(substring(sku from '^[^0-9]*')) collate "C",
                          substring(sku from '[0-9]+')::numeric nulls last,
                          sku collate "C", created_at, id)
  )
  select id as loser, survivor from ranked where group_size > 1 and id <> survivor;

  select count(distinct survivor) into n from _m0030_new;
  insert into _m0030_stats values (0, 'duplicate groups merged', n);
  select count(*) into n from _m0030_new;
  insert into _m0030_stats values (0, 'duplicate products soft-deleted (merged_into set)', n);

  -- 4c. Survivor keeps its data; empty fields are filled from the richest copy.
  update public.parts s set
    attributes = case
      when jsonb_typeof(s.attributes) = 'object' and s.attributes <> '{}'::jsonb then s.attributes
      else coalesce((
        select p.attributes from public.parts p join _m0030_new m on m.loser = p.id
        where m.survivor = s.id and jsonb_typeof(p.attributes) = 'object' and p.attributes <> '{}'::jsonb
        order by (select count(*) from jsonb_object_keys(p.attributes)) desc, p.updated_at desc
        limit 1), s.attributes)
    end,
    tags = case
      when cardinality(s.tags) > 0 then s.tags
      else coalesce((
        select p.tags from public.parts p join _m0030_new m on m.loser = p.id
        where m.survivor = s.id and cardinality(p.tags) > 0
        order by cardinality(p.tags) desc, p.updated_at desc
        limit 1), s.tags)
    end,
    images = case
      when jsonb_typeof(s.images) = 'array' and jsonb_array_length(s.images) > 0 then s.images
      else coalesce((
        select p.images from public.parts p join _m0030_new m on m.loser = p.id
        where m.survivor = s.id and jsonb_typeof(p.images) = 'array' and jsonb_array_length(p.images) > 0
        order by jsonb_array_length(p.images) desc, p.updated_at desc
        limit 1), s.images)
    end,
    image_url = coalesce(s.image_url, (
      select p.image_url from public.parts p join _m0030_new m on m.loser = p.id
      where m.survivor = s.id and p.image_url is not null order by p.updated_at desc limit 1)),
    name_ar = coalesce(s.name_ar, (
      select p.name_ar from public.parts p join _m0030_new m on m.loser = p.id
      where m.survivor = s.id and p.name_ar is not null order by p.updated_at desc limit 1)),
    description = coalesce(s.description, (
      select p.description from public.parts p join _m0030_new m on m.loser = p.id
      where m.survivor = s.id and p.description is not null order by length(p.description) desc limit 1)),
    description_ar = coalesce(s.description_ar, (
      select p.description_ar from public.parts p join _m0030_new m on m.loser = p.id
      where m.survivor = s.id and p.description_ar is not null order by length(p.description_ar) desc limit 1)),
    standard = coalesce(s.standard, (
      select p.standard from public.parts p join _m0030_new m on m.loser = p.id
      where m.survivor = s.id and p.standard is not null order by p.updated_at desc limit 1)),
    is_published = s.is_published or exists (
      select 1 from public.parts p join _m0030_new m on m.loser = p.id
      where m.survivor = s.id and p.is_published)
  where s.id in (select survivor from _m0030_new);

  -- 4d. Soft-delete the copies.
  update public.parts p set merged_into = m.survivor, is_published = false
    from _m0030_new m where p.id = m.loser;

  -- 4e. Every merged row (this run and any earlier one) → its final survivor.
  drop table if exists pg_temp._m0030_map;
  create temp table _m0030_map as
  with recursive chain as (
    select id as loser, merged_into as target, 1 as depth
    from public.parts where merged_into is not null
    union all
    select c.loser, p.merged_into, c.depth + 1
    from chain c join public.parts p on p.id = c.target
    where p.merged_into is not null and c.depth < 20
  )
  select distinct on (c.loser) c.loser, lp.sku as loser_sku, c.target as survivor, sp.sku as survivor_sku
  from chain c
  join public.parts lp on lp.id = c.loser
  join public.parts sp on sp.id = c.target
  order by c.loser, c.depth desc;
  create unique index on _m0030_map (loser);

  -- 4f. Order lines (no unique rule; the part_sku / part_name snapshots stay
  --     as they were sold).
  update public.part_order_items t set part_id = m.survivor
    from _m0030_map m where t.part_id = m.loser;
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'part_order_items repointed', n);

  -- 4g. Project items: unique (project_id, product_id) → merge.
  drop table if exists pg_temp._m0030_pi;
  create temp table _m0030_pi as
  select t.id, t.project_id, t.product_id, coalesce(m.survivor, t.product_id) as target,
         t.quantity, t.qty_from_inventory, t.note, t.created_at
  from public.project_items t left join _m0030_map m on m.loser = t.product_id
  where coalesce(m.survivor, t.product_id) in (select survivor from _m0030_map);

  drop table if exists pg_temp._m0030_pi_g;
  create temp table _m0030_pi_g as
  select project_id, target,
         (array_agg(id order by created_at, id))[1] as keeper,
         sum(quantity)::integer as q, sum(qty_from_inventory)::integer as qi,
         string_agg(distinct btrim(note), ' / ') filter (where coalesce(btrim(note), '') <> '') as notes,
         count(*) as c
  from _m0030_pi group by project_id, target
  having bool_or(product_id <> target);

  update public.project_items t set quantity = g.q, qty_from_inventory = g.qi, note = g.notes
    from _m0030_pi_g g where t.id = g.keeper and g.c > 1;
  delete from public.project_items t
   using _m0030_pi r, _m0030_pi_g g
   where t.id = r.id and r.project_id = g.project_id and r.target = g.target and r.id <> g.keeper;
  get diagnostics n = row_count;
  insert into _m0030_stats values (3, 'project_items merged into another line', n);
  update public.project_items t set product_id = m.survivor
    from _m0030_map m where t.product_id = m.loser;
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'project_items repointed', n);

  -- 4h. Cart lines: unique (user, product, project, kit) → merge.
  drop table if exists pg_temp._m0030_ci;
  create temp table _m0030_ci as
  select t.id, t.user_id, t.product_id, coalesce(m.survivor, t.product_id) as target,
         t.project_id, t.kit_id, t.quantity, t.bom_lines, t.created_at
  from public.cart_items t left join _m0030_map m on m.loser = t.product_id
  where coalesce(m.survivor, t.product_id) in (select survivor from _m0030_map);

  drop table if exists pg_temp._m0030_ci_g;
  create temp table _m0030_ci_g as
  select user_id, target, project_id, kit_id,
         (array_agg(id order by created_at, id))[1] as keeper,
         sum(quantity)::integer as q,
         count(*) as c
  from _m0030_ci group by user_id, target, project_id, kit_id
  having bool_or(product_id <> target);

  update public.cart_items t set
    quantity = g.q,
    bom_lines = (select coalesce(array_agg(distinct x order by x), '{}')
                 from _m0030_ci r, unnest(r.bom_lines) x
                 where r.user_id = g.user_id and r.target = g.target
                   and r.project_id is not distinct from g.project_id
                   and r.kit_id is not distinct from g.kit_id)
    from _m0030_ci_g g where t.id = g.keeper and g.c > 1;
  delete from public.cart_items t
   using _m0030_ci r, _m0030_ci_g g
   where t.id = r.id and r.user_id = g.user_id and r.target = g.target
     and r.project_id is not distinct from g.project_id and r.kit_id is not distinct from g.kit_id
     and r.id <> g.keeper;
  get diagnostics n = row_count;
  insert into _m0030_stats values (3, 'cart_items merged into another line', n);
  update public.cart_items t set product_id = m.survivor
    from _m0030_map m where t.product_id = m.loser;
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'cart_items repointed', n);

  -- 4i. Client inventory: unique (user, product) → merge. project_parts that
  --     point at a line being merged away follow it to the kept line first.
  drop table if exists pg_temp._m0030_inv;
  create temp table _m0030_inv as
  select t.id, t.user_id, t.product_id, coalesce(m.survivor, t.product_id) as target,
         t.quantity, t.note, t.attributes, t.created_at
  from public.client_inventory_items t left join _m0030_map m on m.loser = t.product_id
  where t.product_id is not null
    and coalesce(m.survivor, t.product_id) in (select survivor from _m0030_map);

  drop table if exists pg_temp._m0030_inv_g;
  create temp table _m0030_inv_g as
  select user_id, target,
         (array_agg(id order by created_at, id))[1] as keeper,
         sum(quantity)::integer as q,
         string_agg(distinct btrim(note), ' / ') filter (where coalesce(btrim(note), '') <> '') as notes,
         count(*) as c
  from _m0030_inv group by user_id, target
  having bool_or(product_id <> target);

  update public.client_inventory_items t set
    quantity = g.q,
    note = g.notes,
    attributes = case
      when jsonb_typeof(t.attributes) = 'object' and t.attributes <> '{}'::jsonb then t.attributes
      else coalesce((select r.attributes from _m0030_inv r
                     where r.user_id = g.user_id and r.target = g.target
                       and jsonb_typeof(r.attributes) = 'object' and r.attributes <> '{}'::jsonb
                     order by r.created_at limit 1), t.attributes)
    end
    from _m0030_inv_g g where t.id = g.keeper and g.c > 1;
  update public.project_parts pp set inventory_item_id = g.keeper
    from _m0030_inv r, _m0030_inv_g g
   where pp.inventory_item_id = r.id and r.user_id = g.user_id and r.target = g.target and r.id <> g.keeper;
  delete from public.client_inventory_items t
   using _m0030_inv r, _m0030_inv_g g
   where t.id = r.id and r.user_id = g.user_id and r.target = g.target and r.id <> g.keeper;
  get diagnostics n = row_count;
  insert into _m0030_stats values (3, 'client_inventory_items merged into another line', n);
  update public.client_inventory_items t set product_id = m.survivor
    from _m0030_map m where t.product_id = m.loser;
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'client_inventory_items repointed', n);

  -- 4j. Prototyping parts that were chosen from the catalogue (+ sku snapshot).
  update public.project_parts t set
    catalog_part_id = m.survivor,
    sku = case when t.sku = m.loser_sku then m.survivor_sku else t.sku end
    from _m0030_map m where t.catalog_part_id = m.loser;
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'project_parts repointed', n);

  -- 4k. Supplier offers. One offer per (supplier, supplier SKU) per product:
  --     move the best copy of each; a collision stays on the merged row.
  --     The supplier_offers_refresh trigger re-derives both products.
  update public.supplier_offers t set part_id = c.survivor
    from (
      select o.id, m.survivor, o.supplier_id, coalesce(o.supplier_sku, '') as ssku,
             row_number() over (partition by m.survivor, o.supplier_id, coalesce(o.supplier_sku, '')
                                order by o.active desc, o.last_checked_at desc nulls last, o.created_at, o.id) as rn
      from public.supplier_offers o join _m0030_map m on m.loser = o.part_id
    ) c
   where t.id = c.id and c.rn = 1
     and not exists (select 1 from public.supplier_offers x
                     where x.part_id = c.survivor and x.supplier_id = c.supplier_id
                       and coalesce(x.supplier_sku, '') = c.ssku);
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'supplier_offers repointed', n);
  select count(*) into n from public.supplier_offers o join _m0030_map m on m.loser = o.part_id;
  insert into _m0030_stats values (3, 'supplier_offers left on the merged row (same supplier listing already on survivor)', n);

  -- A pin on a copy carries over when the survivor has none and the pinned
  -- offer moved with it; pins left on merged rows are cleared.
  update public.parts s set pinned_offer_id = c.pinned_offer_id
    from (
      select distinct on (m.survivor) m.survivor, l.pinned_offer_id
      from _m0030_map m
      join public.parts l on l.id = m.loser
      join public.supplier_offers o on o.id = l.pinned_offer_id and o.part_id = m.survivor
      order by m.survivor, l.updated_at desc
    ) c
   where s.id = c.survivor and s.pinned_offer_id is null;
  update public.parts p set pinned_offer_id = null
   where p.merged_into is not null and p.pinned_offer_id is not null
     and not exists (select 1 from public.supplier_offers o where o.id = p.pinned_offer_id and o.part_id = p.id);

  -- 4l. Demand signals.
  update public.demand_signals t set part_id = m.survivor
    from _m0030_map m where t.part_id = m.loser;
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'demand_signals repointed', n);

  -- 4m. projects.bom: a line's chosen product (lines[].choice) and what
  --     fulfilled it (lines[].fulfilled.productId + sku) — lib/prototyping/bom.ts.
  update public.projects p
     set bom = jsonb_set(p.bom, '{lines}', (
       select coalesce(jsonb_agg(
         l
         || case when mc.survivor is not null
                 then jsonb_build_object('choice', mc.survivor::text) else '{}'::jsonb end
         || case when mf.survivor is not null
                 then jsonb_build_object('fulfilled', (l -> 'fulfilled')
                        || jsonb_build_object('productId', mf.survivor::text, 'sku', mf.survivor_sku))
                 else '{}'::jsonb end
         order by ord), '[]'::jsonb)
       from jsonb_array_elements(p.bom -> 'lines') with ordinality as t(l, ord)
       left join _m0030_map mc on mc.loser::text = l ->> 'choice'
       left join _m0030_map mf on jsonb_typeof(l -> 'fulfilled') = 'object'
                              and mf.loser::text = l -> 'fulfilled' ->> 'productId'))
   where p.bom is not null and jsonb_typeof(p.bom -> 'lines') = 'array'
     and exists (select 1 from jsonb_array_elements(p.bom -> 'lines') x
                 join _m0030_map m on m.loser::text = x ->> 'choice'
                                   or m.loser::text = x -> 'fulfilled' ->> 'productId');
  get diagnostics n = row_count;
  insert into _m0030_stats values (2, 'projects.bom repointed (projects)', n);
end $$;

-- ── 5. The guard: one unmerged product per name + material + pack size ─────
create unique index if not exists parts_name_key_uniq
  on public.parts (name_key, coalesce(material, ''), coalesce(pack_size, 1))
  where merged_into is null;

-- ── 6. Report ────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select k, n from _m0030_stats order by ord, k loop
    raise notice '0030: % = %', r.k, r.n;
  end loop;
  raise notice '0030 applied: parts.name_key + merged_into, material normalised, duplicates merged, unique guard parts_name_key_uniq';
end $$;

drop table if exists pg_temp._m0030_stats;
drop table if exists pg_temp._m0030_new;
drop table if exists pg_temp._m0030_map;
drop table if exists pg_temp._m0030_pi;
drop table if exists pg_temp._m0030_pi_g;
drop table if exists pg_temp._m0030_ci;
drop table if exists pg_temp._m0030_ci_g;
drop table if exists pg_temp._m0030_inv;
drop table if exists pg_temp._m0030_inv_g;

commit;
