-- ============================================================================
-- Gestaltung — 0058: customer reviews (score + short comment, moderated)
--                    (P4-03, 2026-10-09)
-- ============================================================================
-- RUN AFTER 0057. Safe to re-run: the table and indexes are `if not exists`,
-- constraints are inline (created once with the table), policies and the
-- trigger are dropped and re-created, the functions are `create or replace`,
-- grants are idempotent, and the back-fill is `on conflict (order_id) do
-- nothing` (a second run inserts nothing).
--
-- CHECKS (read-only; before / after):
--   -- rating signals that will become pending reviews (0053 one-tap rating)
--   select count(*) from public.demand_signals
--    where kind = 'rating' and note like 'order:%';
--   -- after: one pending review per such signal whose order still exists
--   select status, count(*) from public.reviews group by 1;
--   select * from public.approved_reviews();                  -- 0 rows until approved
--   select * from public.approved_reviews('<a sku>', 50);     -- clamped to 24
--   select public.approved_review_count();
--
-- ROLLBACK (manual, one transaction):
--   drop function if exists public.approved_review_count();
--   drop function if exists public.approved_reviews(text, integer);
--   drop function if exists public.set_review_status(uuid, text);
--   drop function if exists public.record_order_review(uuid, integer, text, text);
--   drop table    if exists public.reviews;   -- drops its trigger, indexes, policies
--   (demand_signals and record_order_rating are untouched by this file, so
--   nothing else needs restoring.)
--
-- WHAT CHANGES
-- 1. public.reviews — one review per order (order_id UNIQUE, cascade on order
--    delete). score 1..5, comment ≤ 280 chars (null = no comment), locale
--    'en'|'ar', status pending|approved|rejected (default pending: nothing is
--    public until the owner approves it). skus = JSON array of the order's
--    SKUs (part_order_items.part_sku snapshot + the product's current
--    parts.sku via part_id when different; deduped, nulls/blank dropped) so a
--    product page can show reviews of orders that contained it (GIN index).
--    first_name = the first whitespace-separated word of
--    part_orders.customer_name, max 30 chars, null when empty or when it looks
--    like an email — never the full name, email or phone.
--    moderated_at / moderated_by record the last moderation.
--    RLS: super admin select / update / delete. NO insert policy — rows only
--    come through record_order_review (service_role). anon: no table access.
--
-- 2. record_order_review(p_order, p_score, p_comment, p_locale) → boolean.
--    SECURITY DEFINER, EXECUTE service_role only (called by the server after
--    the signed-link / owner check). Delivered orders only (else false).
--    p_score null = keep the existing score (false when there is no row yet);
--    else 1..5 or 'bad_score'. p_comment null = keep; blank = clear; else
--    trimmed, whitespace collapsed, 'bad_comment' when > 280 chars or it
--    contains a link (http://, https://, www., or a domain-like token).
--    p_locale 'ar' → 'ar', anything else → 'en' (on update the locale only
--    changes when a comment is written). Any real change of score or comment
--    sends the review back to 'pending' (moderated_at/by cleared). skus and
--    first_name are (re)computed from the order on every call.
--
-- 3. set_review_status(p_review, p_status) → boolean (found). Super admin only
--    ('forbidden'); p_status approved|rejected|pending ('bad_status').
--
-- 4. approved_reviews(p_sku default null, p_limit default 6) → table(id,
--    score, comment, first_name, locale, created_at) and approved_review_count()
--    → integer. Public (anon + authenticated); approved only, test orders
--    (0031 part_orders.is_test) excluded; p_sku filters by skus containment;
--    newest first; p_limit clamped 1..24. Nothing else leaves the database
--    (no order id, email, phone or full name).
--
-- 5. Back-fill: each existing 0053 rating signal (demand_signals kind
--    'rating', note 'order:<uuid>') whose order still exists becomes ONE
--    pending review (score = quantity clamped 1..5, no comment, locale 'en',
--    created_at = the signal's created_at).
--
-- 6. record_order_rating (0053) is NOT modified; demand_signals is unchanged.
-- ============================================================================

begin;

-- ─── 1. Table ───────────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null
                  constraint reviews_order_id_key unique
                  references public.part_orders (id) on delete cascade,
  score         smallint not null
                  constraint reviews_score_check check (score between 1 and 5),
  comment       text
                  constraint reviews_comment_check check (comment is null or char_length(comment) <= 280),
  locale        text not null default 'en'
                  constraint reviews_locale_check check (locale in ('en', 'ar')),
  status        text not null default 'pending'
                  constraint reviews_status_check check (status in ('pending', 'approved', 'rejected')),
  skus          jsonb not null default '[]'::jsonb
                  constraint reviews_skus_array_check check (jsonb_typeof(skus) = 'array'),
  first_name    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  moderated_at  timestamptz,
  moderated_by  uuid references auth.users (id) on delete set null
);

create index if not exists reviews_skus_gin_idx
  on public.reviews using gin (skus);
create index if not exists reviews_status_created_idx
  on public.reviews (status, created_at desc);

-- public.set_updated_at() is the shared trigger function from 0004.
drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
  before update on public.reviews
  for each row execute function public.set_updated_at();

alter table public.reviews enable row level security;

revoke all on public.reviews from anon, authenticated;
grant select, update, delete on public.reviews to authenticated;

drop policy if exists reviews_admin_select on public.reviews;
create policy reviews_admin_select on public.reviews
  for select to authenticated
  using (public.is_super_admin());

drop policy if exists reviews_admin_update on public.reviews;
create policy reviews_admin_update on public.reviews
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists reviews_admin_delete on public.reviews;
create policy reviews_admin_delete on public.reviews
  for delete to authenticated
  using (public.is_super_admin());

-- ─── 2. record_order_review (service_role) ──────────────────────────────────
-- Returns true when a review row exists for the order afterwards.
-- Raises: bad_score / bad_comment.
create or replace function public.record_order_review(
  p_order   uuid,
  p_score   integer,
  p_comment text,
  p_locale  text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status      text;
  v_name        text;
  v_first       text;
  v_skus        jsonb;
  v_locale      text;
  v_comment     text;
  v_set_comment boolean := false;
  v_old         record;
  v_new_score   smallint;
  v_new_comment text;
  v_changed     boolean;
begin
  select o.status, o.customer_name
    into v_status, v_name
    from public.part_orders o
   where o.id = p_order;
  if not found or v_status is distinct from 'delivered' then return false; end if;

  if p_score is not null and (p_score < 1 or p_score > 5) then
    raise exception 'bad_score';
  end if;

  if p_comment is not null then
    v_set_comment := true;
    v_comment := pg_catalog.btrim(pg_catalog.regexp_replace(p_comment, '\s+', ' ', 'g'));
    if v_comment = '' then
      v_comment := null;
    elsif pg_catalog.char_length(v_comment) > 280
       or v_comment ~* '(https?://|www\.)'
       or v_comment ~* '\m[a-z0-9-]+\.(com|net|org|qa|io|co|me|ly|info|biz|app|xyz|link)\M' then
      raise exception 'bad_comment';
    end if;
  end if;

  v_locale := case when pg_catalog.lower(pg_catalog.btrim(coalesce(p_locale, ''))) = 'ar' then 'ar' else 'en' end;

  -- First word of the checkout name only (never the full name / an email).
  v_first := (pg_catalog.regexp_match(coalesce(v_name, ''), '\S+'))[1];
  v_first := case when v_first is null or v_first like '%@%' then null
                  else nullif(pg_catalog.left(v_first, 30), '') end;

  -- The order's SKUs: snapshot + current product SKU, deduped, blanks dropped.
  select coalesce(pg_catalog.jsonb_agg(u.s order by u.s), '[]'::jsonb)
    into v_skus
    from (
      select i.part_sku as s
        from public.part_order_items i
       where i.order_id = p_order
      union
      select p.sku
        from public.part_order_items i
        join public.parts p on p.id = i.part_id
       where i.order_id = p_order
    ) u
   where u.s is not null and pg_catalog.btrim(u.s) <> '';

  select r.id, r.score, r.comment
    into v_old
    from public.reviews r
   where r.order_id = p_order
     for update;

  if not found then
    if p_score is null then return false; end if;

    insert into public.reviews (order_id, score, comment, locale, skus, first_name)
    values (p_order, p_score::smallint, v_comment, v_locale, v_skus, v_first)
    on conflict (order_id) do nothing;
    if found then return true; end if;

    -- Lost a race with a parallel call: update the row that won.
    select r.id, r.score, r.comment
      into v_old
      from public.reviews r
     where r.order_id = p_order
       for update;
    if not found then return false; end if;
  end if;

  v_new_score   := coalesce(p_score::smallint, v_old.score);
  v_new_comment := case when v_set_comment then v_comment else v_old.comment end;
  v_changed     := v_new_score is distinct from v_old.score
                or v_new_comment is distinct from v_old.comment;

  update public.reviews
     set score        = v_new_score,
         comment      = v_new_comment,
         locale       = case when v_set_comment and v_comment is not null then v_locale else locale end,
         skus         = v_skus,
         first_name   = v_first,
         status       = case when v_changed then 'pending' else status end,
         moderated_at = case when v_changed then null else moderated_at end,
         moderated_by = case when v_changed then null else moderated_by end
   where id = v_old.id;

  return true;
end $$;

revoke all on function public.record_order_review(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.record_order_review(uuid, integer, text, text) to service_role;

-- ─── 3. set_review_status (super admin) ─────────────────────────────────────
-- Raises: forbidden / bad_status. Returns false when the review is not found.
create or replace function public.set_review_status(p_review uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then raise exception 'forbidden'; end if;
  if p_status is null or p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'bad_status';
  end if;

  update public.reviews
     set status       = p_status,
         moderated_at = case when p_status = 'pending' then null else now() end,
         moderated_by = auth.uid()
   where id = p_review;

  return found;
end $$;

revoke all on function public.set_review_status(uuid, text) from public, anon;
grant execute on function public.set_review_status(uuid, text) to authenticated;

-- ─── 4. Public reads (anon + authenticated) ─────────────────────────────────
-- skus @> ['<sku>'] uses the GIN index (default jsonb_ops) and needs no
-- operator qualification under search_path = '' (pg_catalog is implicit).
create or replace function public.approved_reviews(p_sku text default null, p_limit integer default 6)
returns table (id uuid, score integer, comment text, first_name text, locale text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id,
         r.score::integer,
         r.comment,
         r.first_name,
         r.locale,
         r.created_at
    from public.reviews r
    join public.part_orders o on o.id = r.order_id
   where r.status = 'approved'
     and o.is_test is not true
     and (p_sku is null or r.skus @> pg_catalog.jsonb_build_array(p_sku))
   order by r.created_at desc, r.id
   limit greatest(1, least(24, coalesce(p_limit, 6)));
$$;

revoke all on function public.approved_reviews(text, integer) from public;
grant execute on function public.approved_reviews(text, integer) to anon, authenticated;

create or replace function public.approved_review_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.reviews r
    join public.part_orders o on o.id = r.order_id
   where r.status = 'approved'
     and o.is_test is not true;
$$;

revoke all on function public.approved_review_count() from public;
grant execute on function public.approved_review_count() to anon, authenticated;

-- ─── 5. Back-fill from the 0053 one-tap rating signals ──────────────────────
-- The uuid cast sits inside a CASE so a malformed note never reaches it.
insert into public.reviews (order_id, score, comment, locale, status, skus, first_name, created_at)
select o.id,
       greatest(1, least(5, sig.quantity))::smallint,
       null,
       'en',
       'pending',
       coalesce(sk.skus, '[]'::jsonb),
       case when fw.w is null or fw.w like '%@%' then null
            else nullif(left(fw.w, 30), '') end,
       sig.created_at
  from (
    select distinct on (x.order_id) x.order_id, x.quantity, x.created_at
      from (
        select case
                 when d.note ~* '^order:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                   then substring(d.note from 7)::uuid
               end as order_id,
               d.quantity,
               d.created_at
          from public.demand_signals d
         where d.kind = 'rating'
           and d.note like 'order:%'
           and d.quantity is not null
      ) x
     where x.order_id is not null
     order by x.order_id, x.created_at desc
  ) sig
  join public.part_orders o on o.id = sig.order_id
  cross join lateral (
    select (regexp_match(coalesce(o.customer_name, ''), '\S+'))[1] as w
  ) fw
  left join lateral (
    select jsonb_agg(u.s order by u.s) as skus
      from (
        select i.part_sku as s
          from public.part_order_items i
         where i.order_id = o.id
        union
        select p.sku
          from public.part_order_items i
          join public.parts p on p.id = i.part_id
         where i.order_id = o.id
      ) u
     where u.s is not null and btrim(u.s) <> ''
  ) sk on true
on conflict (order_id) do nothing;

do $$ begin raise notice '0058 applied: reviews table (RLS super admin), record_order_review (service_role), set_review_status, approved_reviews / approved_review_count (public), rating signals back-filled as pending reviews'; end $$;

commit;
