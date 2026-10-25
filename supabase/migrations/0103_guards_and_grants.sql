-- ============================================================================
-- Gestaltung — 0103: guards and grants (security audit 2026-10)
--   DB-07, DB-08, DB-10, DB-11, DB-12, DB-13, DB-16, DB-17, DB-18, DB-19,
--   DB-22, API-02
-- ============================================================================
-- One section per finding. Every function keeps its signature, so no app
-- change is needed. Bodies copied from the migration named in each section,
-- with only the marked "0103" lines added.
--
--   DB-07  engineering_job_refund_internal (0091): a cancelled / failed job
--          refunds each token kind it was paid with (Maker Pass tokens come
--          back as idea_pass — and expire with the pass — not as permanent
--          idea tokens). engineering_job_cancel itself is unchanged.
--   DB-08  claim_guest_work (0071): drops the guest's idea_welcome row when the
--          account already has one, so the claim no longer aborts.
--   DB-10  part_order_items: quantity <= 1000 per line, <= 300 lines per
--          order ('too_many_lines' / 'quantity_too_large'), and a CLASS order
--          (part_orders.class_id is not null, 0097) has no line cap at all;
--          part_orders: at
--          most 10 new orders per hour per customer phone or email
--          ('too_many_orders'). The phone is matched on its last 8 digits (a
--          Qatar mobile), so '+974 6666 0002', '0097466660002' and '66660002'
--          are one phone. super_admin and service_role are exempt.
--   DB-11  log_project_event: no EXECUTE for anon / authenticated (only
--          SECURITY DEFINER callers and triggers use it).
--   DB-12  projects: anon/authenticated non-admin writes cannot change
--          is_test or tenant_id (UPDATE keeps the stored values; INSERT
--          forces is_test = false, tenant_id = null).
--   DB-13  claim_project (0045): refuses ('invalid') for class team projects;
--          project_recovery_begin (0045, API-02 below) refuses them the same
--          way, so no recovery link is e-mailed for a link that cannot work.
--   DB-16  inquiries: length limits (name 120, phone 40, email 160, message
--          8000; added NOT VALID, so old rows are not checked) and a trigger
--          that forces status = 'new', is_test = false on anon/authenticated
--          inserts.
--   DB-17  set_order_payment_method (0044): only for the caller's own order
--          (profile_id is not distinct from auth.uid(): a guest checkout
--          without a session still sets its own null-profile order).
--   DB-18  refresh_part_sourcing (0098): admins, service_role, the sourcing
--          triggers and direct DB sessions only. Re-pinned to
--          search_path = '' with qualified names (body otherwise identical).
--   DB-19  offer_landed_cost_qar (0028): no EXECUTE for anon; inside, the
--          same caller rule as DB-18 (admin edit page, refresh, cron).
--   DB-22  class_teacher_of_project / is_class_project /
--          is_class_teacher_of_project: no EXECUTE for anon. The 0096 policy
--          projects_select_class_teacher (created with no TO clause, so it
--          applied to anon too) is limited to authenticated: otherwise every
--          anon SELECT on projects raised "permission denied for function
--          is_class_teacher_of_project" instead of returning no rows.
--   API-02 project_recovery_begin (0045): also at most 3 recovery emails per
--          contact address per 24 h, whichever session asks.
--
-- RUN AFTER 0098 (still NOT RUN: refresh_part_sourcing is replaced on top of its 0098 body)
-- and after 0099 (and 0100-0102). Safe to re-run (create or replace,
-- drop … if exists before create trigger / add constraint, revoke/grant).
--
-- REQUIRES 0097 (part_orders.class_id) — also still NOT RUN. The class
-- exemption in part_order_items_limits() reads part_orders.class_id, and
-- plpgsql resolves that column only when the trigger first fires, so running
-- 0103 before 0097 applies cleanly but then makes EVERY part_order_items
-- insert fail with "column o.class_id does not exist". Run 0096 → 0097 → 0098
-- → 0099 → 0100-0102 → 0103, in that order.
--
-- ROLLBACK (manual, one transaction):
--   -- functions: re-run the bodies from the migrations named above:
--   --   engineering_job_refund_internal (0091), claim_guest_work (0071),
--   --   claim_project + project_recovery_begin (0045),
--   --   set_order_payment_method (0044), refresh_part_sourcing (0098),
--   --   offer_landed_cost_qar (0028).
--   drop trigger  if exists part_order_items_limits on public.part_order_items;
--   drop function if exists public.part_order_items_limits();
--   drop trigger  if exists part_orders_rate_limit on public.part_orders;
--   drop function if exists public.part_orders_rate_limit();
--   drop trigger  if exists projects_guard_admin_columns on public.projects;
--   drop function if exists public.projects_guard_admin_columns();
--   drop trigger  if exists inquiries_guard_insert on public.inquiries;
--   drop function if exists public.inquiries_guard_insert();
--   alter table public.inquiries drop constraint if exists inquiries_field_lengths;
--   grant execute on function public.log_project_event(uuid, text, jsonb) to anon, authenticated;
--   grant execute on function public.offer_landed_cost_qar(uuid) to anon, authenticated;
--   grant execute on function public.class_teacher_of_project(uuid) to anon;
--   grant execute on function public.is_class_project(uuid) to anon;
--   grant execute on function public.is_class_teacher_of_project(uuid) to anon;
--   alter policy projects_select_class_teacher on public.projects to public;
--   notify pgrst, 'reload schema';
-- ============================================================================

-- ── DB-07: refunds go back as the kind that was paid ─────────────────────────
create or replace function public.engineering_job_refund_internal(p_job uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  j public.engineering_jobs;
  r record;
  n integer := 0;
begin
  select * into j from public.engineering_jobs where id = p_job;
  if not found or coalesce(j.tokens, 0) <= 0 then return; end if;
  if exists (select 1 from public.credits_ledger where reason = 'job_refund:' || j.id::text) then return; end if;

  -- What the job actually took, per kind (engineering_job_submit, 0091).
  for r in
    select l.kind, -sum(l.delta)::integer as amount
      from public.credits_ledger l
     where l.user_id = j.user_id and l.reason = 'job:' || j.id::text and l.delta < 0
     group by l.kind
  loop
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (j.user_id, r.kind, r.amount, 'job_refund:' || j.id::text, 'Engineering job refund');
    n := n + 1;
  end loop;

  if n = 0 then
    -- No charge rows to mirror (should not happen): the 0091 behaviour.
    insert into public.credits_ledger (user_id, kind, delta, reason, note)
    values (j.user_id, 'idea', j.tokens, 'job_refund:' || j.id::text, 'Engineering job refund');
  end if;

  -- Pass tokens of a pass that has already ended expire straight away.
  perform public.idea_pass_sweep(j.user_id);
end $$;

revoke all on function public.engineering_job_refund_internal(uuid) from public, anon, authenticated;

-- ── DB-08: claim_guest_work (0071) + the welcome-row fix ─────────────────────
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

  -- 0103 (DB-08): one welcome grant per account. The unique index
  -- credits_ledger_idea_welcome_once (0088) made the move below abort the
  -- whole claim when both held one; the guest's copy is dropped instead.
  delete from public.credits_ledger g
   where g.user_id = p_from
     and g.kind = 'idea'
     and g.reason = 'idea_welcome'
     and exists (select 1 from public.credits_ledger t
                  where t.user_id = p_to and t.kind = 'idea' and t.reason = 'idea_welcome');

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

-- ── DB-10: order size and rate limits ────────────────────────────────────────
create or replace function public.part_order_items_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_super_admin() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if new.quantity > 1000 then
    raise exception 'quantity_too_large';
  end if;
  -- 0103 (owner decision, 2026-10-24): 300 lines per order, and a class order
  -- (part_orders.class_id is not null, 0097) is exempt from the line cap
  -- altogether — a teacher orders for a whole class in one go. The per-line
  -- quantity cap above still applies to class orders.
  if not exists (select 1 from public.part_orders o
                  where o.id = new.order_id and o.class_id is not null)
     and (select count(*) from public.part_order_items i where i.order_id = new.order_id) >= 300 then
    raise exception 'too_many_lines';
  end if;
  return new;
end $$;

revoke all on function public.part_order_items_limits() from public, anon, authenticated;

drop trigger if exists part_order_items_limits on public.part_order_items;
create trigger part_order_items_limits
  before insert on public.part_order_items
  for each row execute function public.part_order_items_limits();

create or replace function public.part_orders_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Last 8 digits: '+974 6666 0002', '0097466660002' and '66660002' are one phone.
  v_phone text := nullif(right(regexp_replace(coalesce(new.customer_phone, ''), '[^0-9]', '', 'g'), 8), '');
  v_email text := nullif(lower(btrim(coalesce(new.customer_email, ''))), '');
begin
  if public.is_super_admin() or coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;
  if (v_phone is not null or v_email is not null)
     and (select count(*)
            from public.part_orders o
           where o.created_at > now() - interval '1 hour'
             and ((v_phone is not null and right(regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g'), 8) = v_phone)
                  or (v_email is not null and lower(btrim(coalesce(o.customer_email, ''))) = v_email))) >= 10 then
    raise exception 'too_many_orders';
  end if;
  return new;
end $$;

revoke all on function public.part_orders_rate_limit() from public, anon, authenticated;

drop trigger if exists part_orders_rate_limit on public.part_orders;
create trigger part_orders_rate_limit
  before insert on public.part_orders
  for each row execute function public.part_orders_rate_limit();

-- ── DB-11: log_project_event is internal ─────────────────────────────────────
revoke all on function public.log_project_event(uuid, text, jsonb) from public, anon, authenticated;

-- ── DB-12: is_test / tenant_id are admin-only columns ────────────────────────
create or replace function public.projects_guard_admin_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_super_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_test   := false;
    new.tenant_id := null;
  else
    new.is_test   := old.is_test;
    new.tenant_id := old.tenant_id;
  end if;
  return new;
end $$;

revoke all on function public.projects_guard_admin_columns() from public, anon, authenticated;

drop trigger if exists projects_guard_admin_columns on public.projects;
create trigger projects_guard_admin_columns
  before insert or update of is_test, tenant_id on public.projects
  for each row execute function public.projects_guard_admin_columns();

-- ── DB-13: claim_project (0045) refuses class team projects ──────────────────
create or replace function public.claim_project(p_project uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       record;
  v_anonymous boolean;
  v_token     uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if p_project is null or p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select id, user_id, name, contact_email, recovery_token into v_row
    from public.projects
   where id = p_project
   for update;
  if not found or v_row.recovery_token is null or v_row.recovery_token <> p_token then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- 0103 (DB-13): a class team project never changes hands by link (its
  -- teacher can read the token); answered like a wrong key.
  if public.is_class_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if v_row.user_id = v_uid then
    return jsonb_build_object('ok', true, 'status', 'already_owner');
  end if;

  select coalesce(u.is_anonymous, false) into v_anonymous
    from auth.users u where u.id = v_row.user_id;
  if not coalesce(v_anonymous, false) then
    return jsonb_build_object('ok', false, 'reason', 'has_account');
  end if;

  begin
    perform set_config('app.recovery_write', 'on', true);
    update public.projects
       set user_id = v_uid,
           recovery_token = gen_random_uuid()
     where id = p_project
    returning recovery_token into v_token;
    perform set_config('app.recovery_write', 'off', true);
  exception when raise_exception then
    perform set_config('app.recovery_write', 'off', true);
    if sqlerrm = 'project_limit' then
      return jsonb_build_object('ok', false, 'reason', 'project_limit');
    end if;
    raise;
  end;

  perform public.log_project_event(p_project, 'project_claimed', '{}'::jsonb);

  return jsonb_build_object(
    'ok', true,
    'status', 'claimed',
    'token', v_token,
    'name', v_row.name,
    'email', v_row.contact_email
  );
end $$;

revoke all on function public.claim_project(uuid, uuid) from public, anon;
grant execute on function public.claim_project(uuid, uuid) to authenticated;

-- ── DB-16: inquiries sizes and status on public inserts ──────────────────────
alter table public.inquiries drop constraint if exists inquiries_field_lengths;
alter table public.inquiries add constraint inquiries_field_lengths
  check (char_length(name) <= 120
         and char_length(phone) <= 40
         and char_length(coalesce(email, '')) <= 160
         and char_length(message) <= 8000)
  not valid;

create or replace function public.inquiries_guard_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') and not public.is_super_admin() then
    new.status  := 'new';
    new.is_test := false;
  end if;
  return new;
end $$;

revoke all on function public.inquiries_guard_insert() from public, anon, authenticated;

drop trigger if exists inquiries_guard_insert on public.inquiries;
create trigger inquiries_guard_insert
  before insert on public.inquiries
  for each row execute function public.inquiries_guard_insert();

-- ── DB-17: set_order_payment_method (0044) for the caller's own order ────────
create or replace function public.set_order_payment_method(p_order uuid, p_method text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n       integer;
  v_email text;
begin
  if p_method not in ('cash_on_delivery', 'fawran', 'bank_transfer') then raise exception 'bad payment method'; end if;
  if p_method = 'bank_transfer' then
    select customer_email into v_email from public.part_orders
     where id = p_order and profile_id is not distinct from auth.uid();
    if found and not public.is_plausible_email(v_email) then
      raise exception 'email is required for bank transfer';
    end if;
  end if;
  update public.part_orders
     set payment_method = p_method
   where id = p_order
     and profile_id is not distinct from auth.uid()   -- 0103 (DB-17): own order only
     and payment_method is null
     and created_at > now() - interval '1 hour';
  get diagnostics n = row_count;
  return n = 1;
end $$;

revoke all on function public.set_order_payment_method(uuid, text) from public;
grant execute on function public.set_order_payment_method(uuid, text) to anon, authenticated;

-- ── DB-18: refresh_part_sourcing (0098) with a caller check ──────────────────
create or replace function public.refresh_part_sourcing(p_part_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_part        public.parts%rowtype;
  v_offer       public.supplier_offers%rowtype;
  v_supplier    public.suppliers%rowtype;
  v_offer_id    uuid;
  v_fx          numeric;
  v_margin      numeric;
  v_commission  numeric;
  v_floor       numeric;
  v_landed      numeric;
  v_price       numeric;
  v_income      numeric;
  v_pct         numeric;
  v_class       text;
begin
  -- 0103 (DB-18): admins, the service role, the sourcing triggers (depth > 0)
  -- and direct database sessions (no JWT role) only.
  if not public.is_super_admin()
     and coalesce(auth.role(), '') <> 'service_role'
     and pg_trigger_depth() = 0
     and auth.role() is not null then
    raise exception 'not allowed';
  end if;

  select * into v_part from public.parts where id = p_part_id;
  if not found then return; end if;

  -- A pinned offer that still exists and is active wins.
  select o.id into v_offer_id from public.supplier_offers o
  where o.id = v_part.pinned_offer_id and o.part_id = p_part_id and o.active;

  if v_offer_id is null then
    select o.id into v_offer_id
    from public.supplier_offers o
    join public.suppliers s on s.id = o.supplier_id
    where o.part_id = p_part_id and o.active and s.active
      -- a mirror product can only follow an offer that has a retail price and a commission
      and (v_part.pricing_mode <> 'mirror' or (o.retail_price is not null and s.commission_percent is not null))
    order by (o.availability = 'in_stock') desc,
             coalesce(s.rank, 50) asc,
             o.lead_time_days asc nulls last,
             public.offer_landed_cost_qar(o.id) asc nulls last,
             o.created_at asc
    limit 1;
  end if;

  -- Two floors, because "income" means two different things. A markup part is
  -- measured against the margin we insist on; a mirror part only ever earns
  -- the supplier's commission, so it is measured against the lowest
  -- commission we accept. Comparing a commission to a margin floor flags
  -- every mirror part forever (see the WHY in 0098).
  select coalesce((value #>> '{}')::numeric, 15) into v_margin
    from public.store_settings where key = 'margin_floor_pct';
  select coalesce((value #>> '{}')::numeric, 8) into v_commission
    from public.store_settings where key = 'commission_floor_pct';
  v_floor := case
    when v_part.pricing_mode = 'mirror' then coalesce(v_commission, 8)
    else coalesce(v_margin, 15)
  end;

  if v_offer_id is null then
    update public.parts set preferred_offer_id = null, landed_cost_qar = null, expected_income_qar = null,
      income_pct = null, below_floor = false, lead_time_class = null
    where id = p_part_id;
    return;
  end if;

  select * into v_offer from public.supplier_offers where id = v_offer_id;
  select * into v_supplier from public.suppliers where id = v_offer.supplier_id;
  v_landed := public.offer_landed_cost_qar(v_offer_id);
  v_price  := v_part.unit_price;

  if v_part.pricing_mode = 'mirror' and v_offer.retail_price is not null then
    select coalesce((value ->> v_offer.currency)::numeric, case when v_offer.currency = 'QAR' then 1 end)
      into v_fx from public.store_settings where key = 'fx_to_qar';
    if v_fx is not null then
      v_price := round(v_offer.retail_price * v_fx * v_part.pack_size::numeric / v_offer.pack_size, 2);
    end if;
    v_income := round(v_price * coalesce(v_supplier.commission_percent, 0) / 100, 2);
  else
    v_income := case when v_landed is null then null else round(v_price - v_landed, 2) end;
  end if;

  v_pct := case when v_income is null or v_price = 0 then null else round(v_income / v_price * 100, 2) end;

  v_class := case
    when v_offer.lead_time_days is null then '2_4_weeks'
    when v_offer.lead_time_days <= 2 then 'in_stock'
    when v_offer.lead_time_days <= 5 then '3_5_days'
    when v_offer.lead_time_days <= 14 then '1_2_weeks'
    else '2_4_weeks'
  end;

  update public.parts set
    preferred_offer_id  = v_offer_id,
    unit_price          = v_price,
    landed_cost_qar     = v_landed,
    expected_income_qar = v_income,
    income_pct          = v_pct,
    below_floor         = coalesce(v_pct < v_floor, false),
    lead_time_class     = v_class
  where id = p_part_id;
end;
$$;

revoke all on function public.refresh_part_sourcing(uuid) from public, anon;
grant execute on function public.refresh_part_sourcing(uuid) to authenticated, service_role;

-- ── DB-19: offer_landed_cost_qar (0028) for admins / internal use ────────────
create or replace function public.offer_landed_cost_qar(p_offer_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin()
     and coalesce(auth.role(), '') <> 'service_role'
     and pg_trigger_depth() = 0
     and auth.role() is not null then
    raise exception 'not allowed';
  end if;
  return (
    select round(
      o.cost
      * coalesce((select (value ->> o.currency)::numeric from public.store_settings where key = 'fx_to_qar'),
                 case when o.currency = 'QAR' then 1 end)
      * (1 + s.landed_overhead_pct / 100)
      * p.pack_size::numeric / o.pack_size, 2)
    from public.supplier_offers o
    join public.suppliers s on s.id = o.supplier_id
    join public.parts p on p.id = o.part_id
    where o.id = p_offer_id
  );
end $$;

revoke all on function public.offer_landed_cost_qar(uuid) from public, anon;
grant execute on function public.offer_landed_cost_qar(uuid) to authenticated, service_role;

-- ── DB-22: class helpers are not for anon ────────────────────────────────────
revoke all on function public.class_teacher_of_project(uuid) from public, anon;
revoke all on function public.is_class_project(uuid) from public, anon;
revoke all on function public.is_class_teacher_of_project(uuid) from public, anon;
grant execute on function public.class_teacher_of_project(uuid) to authenticated;
grant execute on function public.is_class_project(uuid) to authenticated;
grant execute on function public.is_class_teacher_of_project(uuid) to authenticated;
-- The teacher-read policy needs is_class_teacher_of_project, so it may only
-- apply to sessions; anon SELECT on projects then returns no rows again.
alter policy projects_select_class_teacher on public.projects to authenticated;

-- ── API-02: project_recovery_begin (0045) per-address cap ────────────────────
create or replace function public.project_recovery_begin(p_project uuid, p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_row     record;
  v_recent  integer;
  v_token   uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;

  select id, name, created_at, recovery_emailed_at into v_row
    from public.projects
   where id = p_project and user_id = v_uid
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_owner');
  end if;
  -- 0103 (DB-13): claim_project refuses class team projects, so no link is
  -- e-mailed for them either; answered like claim_project.
  if public.is_class_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_row.recovery_emailed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_sent');
  end if;
  if v_row.created_at < now() - interval '1 hour' then
    return jsonb_build_object('ok', false, 'reason', 'too_late');
  end if;

  select count(*) into v_recent
    from public.projects
   where user_id = v_uid
     and recovery_emailed_at > now() - interval '24 hours';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  -- 0103 (API-02): also 3 per day per ADDRESS, whoever asks — a new guest
  -- session must not reset the cap for the same recipient.
  select count(*) into v_recent
    from public.projects
   where contact_email = v_email
     and recovery_emailed_at > now() - interval '24 hours';
  if v_recent >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  perform set_config('app.recovery_write', 'on', true);
  update public.projects
     set contact_email = v_email,
         recovery_token = gen_random_uuid(),
         recovery_emailed_at = now()
   where id = p_project
  returning recovery_token into v_token;
  perform set_config('app.recovery_write', 'off', true);

  return jsonb_build_object('ok', true, 'token', v_token, 'name', v_row.name, 'email', v_email);
end $$;

revoke all on function public.project_recovery_begin(uuid, text) from public, anon;
grant execute on function public.project_recovery_begin(uuid, text) to authenticated;

notify pgrst, 'reload schema';

do $$ begin raise notice '0103 applied: guards and grants (DB-07, DB-08, DB-10, DB-11, DB-12, DB-13, DB-16, DB-17, DB-18, DB-19, DB-22, API-02)'; end $$;
