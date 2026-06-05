-- ============================================================================
-- Gestaltung — Stage 5: Multi-tenant inventory
-- ============================================================================
-- Run AFTER 0001_auth_roles_rls.sql. Reuses the Stage 4 helpers
-- is_super_admin() / current_user_tenant_id(). Each workshop/client tenant has
-- its own isolated inventory; super_admin sees and manages every tenant's.
-- Isolation is enforced by RLS, NOT the API key.
-- ============================================================================

create table if not exists public.inventory_items (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete cascade,
  sku                 text not null,
  name                text not null,
  description         text,
  category            text,
  quantity            integer not null default 0,
  unit                text not null default 'pcs',
  unit_price          numeric(12, 2),
  low_stock_threshold integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists inventory_items_tenant_id_idx
  on public.inventory_items (tenant_id);

-- SKU is unique within a tenant (two tenants may reuse the same SKU).
create unique index if not exists inventory_items_tenant_sku_uniq
  on public.inventory_items (tenant_id, sku);

-- ----------------------------------------------------------------------------
-- Triggers: keep updated_at fresh, and default tenant_id to the caller's tenant
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- If tenant_id is omitted on insert, force it to the caller's own tenant. A
-- super_admin can still pass an explicit tenant_id (it won't be overwritten).
create or replace function public.inventory_default_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_user_tenant_id();
  end if;
  return new;
end;
$$;

drop trigger if exists inventory_items_default_tenant on public.inventory_items;
create trigger inventory_items_default_tenant
  before insert on public.inventory_items
  for each row execute function public.inventory_default_tenant();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------

alter table public.inventory_items enable row level security;

grant select, insert, update, delete on public.inventory_items to authenticated;

-- super_admin: every row. workshop/client: only rows in their own tenant.
drop policy if exists inventory_select on public.inventory_items;
create policy inventory_select on public.inventory_items
  for select to authenticated
  using (
    public.is_super_admin()
    or tenant_id = public.current_user_tenant_id()
  );

-- INSERT: non-super_admin can only create rows for their own tenant; the
-- with-check rejects any attempt to write another tenant_id.
drop policy if exists inventory_insert on public.inventory_items;
create policy inventory_insert on public.inventory_items
  for insert to authenticated
  with check (
    public.is_super_admin()
    or tenant_id = public.current_user_tenant_id()
  );

drop policy if exists inventory_update on public.inventory_items;
create policy inventory_update on public.inventory_items
  for update to authenticated
  using (
    public.is_super_admin()
    or tenant_id = public.current_user_tenant_id()
  )
  with check (
    public.is_super_admin()
    or tenant_id = public.current_user_tenant_id()
  );

drop policy if exists inventory_delete on public.inventory_items;
create policy inventory_delete on public.inventory_items
  for delete to authenticated
  using (
    public.is_super_admin()
    or tenant_id = public.current_user_tenant_id()
  );
