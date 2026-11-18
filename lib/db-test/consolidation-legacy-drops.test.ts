// Consolidation 2026-11 drop migrations, applied on the REAL legacy schema:
// 0001 (tenants, profiles, helpers) + 0004 (inventory_items) + 0005-0010 (the
// jobs pipeline incl. job_bom and the old cad-files storage policies) inside
// PGlite, plus a stub of the live customer inventory (client_inventory_items,
// 0017). Each drop migration is applied twice (it must re-run). Never touches
// Supabase.
import { describe, expect, it } from "vitest";

import { migration, pgliteDb } from "./pglite";

const BASE = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema storage;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text
$$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- The parts of Supabase Storage the policies use.
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant execute on function storage.foldername(text) to anon, authenticated;
`;

/** The live customer inventory (0017), reduced to what its RLS needs. */
const CLIENT_INVENTORY = `
create table public.client_inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  quantity numeric not null default 0,
  updated_at timestamptz not null default now()
);
create trigger client_inventory_set_updated_at before update on public.client_inventory_items
  for each row execute function public.set_updated_at();
alter table public.client_inventory_items enable row level security;
grant select, insert, update, delete on public.client_inventory_items to authenticated;
create policy client_inventory_select on public.client_inventory_items for select to authenticated using (user_id = auth.uid());
create policy client_inventory_insert on public.client_inventory_items for insert to authenticated with check (user_id = auth.uid());
create policy client_inventory_update on public.client_inventory_items for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
`;

/** 0018's owner-scoped cad-files policies (replace the 0006 tenant-path ones). */
const CAD_FILES_0018 = `
drop policy if exists cad_files_admin_all on storage.objects;
drop policy if exists cad_files_select on storage.objects;
drop policy if exists cad_files_insert on storage.objects;
drop policy if exists cad_files_delete on storage.objects;
create policy cad_files_select on storage.objects for select to authenticated
  using (bucket_id = 'cad-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin()));
create policy cad_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'cad-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy cad_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'cad-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin()));
`;

const LEGACY = [
  "0001_auth_roles_rls.sql",
  "0004_inventory_items.sql",
  "0005_jobs.sql",
  "0006_job_workflow.sql",
  "0007_internal_jobs.sql",
  "0008_job_variations.sql",
  "0009_security_hardening.sql",
  "0010_job_upsells.sql",
];

// Each case applies 0001 + 0004-0010 to a fresh PGlite: seconds alone, much more under a loaded full run.
const LEGACY_TIMEOUT = 120_000;

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-0000000000b0";
const TENANT = "00000000-0000-4000-8000-000000007e17";

async function legacyDb(opts: { cadFiles0018?: boolean } = {}) {
  const h = pgliteDb();
  await h.db.exec(BASE);
  for (const f of LEGACY) await h.db.exec(migration(f));
  if (opts.cadFiles0018 ?? true) await h.db.exec(CAD_FILES_0018);
  await h.db.exec(CLIENT_INVENTORY);
  await h.db.exec(`
    insert into auth.users (id, email) values ('${ALICE}', 'a@example.com'), ('${BOB}', 'b@example.com');
    insert into public.tenants (id, type, name) values ('${TENANT}', 'workshop', 'Shop');
    update public.profiles set tenant_id = '${TENANT}', role = 'workshop' where id = '${ALICE}';
    insert into public.inventory_items (tenant_id, sku, name, quantity) values ('${TENANT}', 'S1', 'Bolt', 3);
    insert into public.client_inventory_items (user_id, name, quantity) values ('${ALICE}', 'My resistor', 10);
    insert into storage.objects (bucket_id, name) values ('cad-files', '${ALICE}/p1/part.stl'), ('cad-files', '${BOB}/p2/part.stl');
  `);
  return h;
}

const exists = async (rows: ReturnType<typeof pgliteDb>["rows"], rel: string) =>
  (await rows<{ r: string | null }>("select to_regclass($1)::text as r", [rel]))[0].r !== null;
const fnExists = async (rows: ReturnType<typeof pgliteDb>["rows"], sig: string) =>
  (await rows<{ r: string | null }>("select to_regprocedure($1)::text as r", [sig]))[0].r !== null;

describe("0108 drop tenant inventory", () => {
  it("drops inventory_items, job_bom and inventory_default_tenant(), keeps tenants and the customer inventory", async () => {
    const { rows, as, applyTwice } = await legacyDb();
    expect(await exists(rows, "public.inventory_items")).toBe(true);
    expect(await exists(rows, "public.job_bom")).toBe(true);

    await applyTwice("0108_drop_tenant_inventory.sql");

    expect(await exists(rows, "public.inventory_items")).toBe(false);
    expect(await exists(rows, "public.job_bom")).toBe(false);
    expect(await fnExists(rows, "public.inventory_default_tenant()")).toBe(false);
    // Kept: tenants + profiles.tenant_id and the helper their policies call.
    expect(await fnExists(rows, "public.current_user_tenant_id()")).toBe(true);
    expect(await exists(rows, "public.jobs")).toBe(true); // jobs are 0109's business
    const tenants = await as(ALICE, () => rows<{ name: string }>("select name from public.tenants"));
    expect(tenants.map((t) => t.name)).toEqual(["Shop"]);
    const prof = await as(ALICE, () => rows<{ tenant_id: string }>("select tenant_id from public.profiles where id = $1", [ALICE]));
    expect(prof[0].tenant_id).toBe(TENANT);

    // The customer's own inventory still works under RLS.
    const mine = await as(ALICE, () => rows<{ name: string }>("select name from public.client_inventory_items"));
    expect(mine.map((r) => r.name)).toEqual(["My resistor"]);
    expect(await as(BOB, () => rows("select 1 from public.client_inventory_items"))).toEqual([]);
    await as(ALICE, () => rows("update public.client_inventory_items set quantity = 11"));
    expect((await rows<{ quantity: string }>("select quantity::text from public.client_inventory_items"))[0].quantity).toBe("11");
  }, LEGACY_TIMEOUT);
});

const JOB_FUNCTIONS = [
  "public.jobs_default_tenant()",
  "public.jobs_guard_status()",
  "public.jobs_status_transition()",
  "public.jobs_log_insert_event()",
  "public.jobs_log_status_event()",
  "public.can_manage_job_bom(uuid)",
  "public.accessible_client_tenants()",
  "public.can_read_cad_object(text)",
  "public.can_access_job(uuid)",
  "public.current_user_role()",
];
const JOB_TABLES = ["public.jobs", "public.job_files", "public.job_events", "public.job_bom", "public.job_variations"];

describe("0109 drop jobs remnants", () => {
  it("drops every jobs table and helper; the cad-files policies projects use keep working", async () => {
    const { rows, as, fails, applyTwice } = await legacyDb();
    for (const t of JOB_TABLES) expect(await exists(rows, t), t).toBe(true);

    await applyTwice("0108_drop_tenant_inventory.sql");
    await applyTwice("0109_drop_jobs_remnants.sql");

    for (const t of JOB_TABLES) expect(await exists(rows, t), t).toBe(false);
    for (const f of JOB_FUNCTIONS) expect(await fnExists(rows, f), f).toBe(false);
    for (const f of ["public.is_super_admin()", "public.current_user_tenant_id()", "public.set_updated_at()"])
      expect(await fnExists(rows, f), f).toBe(true);

    // cad-files (0018 owner-scoped policies): own folder readable and writable, nobody else's.
    const seen = await as(ALICE, () => rows<{ name: string }>("select name from storage.objects where bucket_id = 'cad-files'"));
    expect(seen.map((r) => r.name)).toEqual([`${ALICE}/p1/part.stl`]);
    expect(await as(ALICE, () => fails(`insert into storage.objects (bucket_id, name) values ('cad-files', '${ALICE}/p1/new.step')`))).toBeNull();
    expect(await as(ALICE, () => fails(`insert into storage.objects (bucket_id, name) values ('cad-files', '${BOB}/p2/x.step')`))).toMatch(/row-level security/);
    // tenants / profiles policies still resolve current_user_tenant_id().
    expect((await as(ALICE, () => rows("select 1 from public.tenants"))).length).toBe(1);
  }, LEGACY_TIMEOUT);

  it("is a no-op after 0013 already dropped the pipeline", async () => {
    const { db, rows, applyTwice } = await legacyDb({ cadFiles0018: false });
    await db.exec(migration("0013_drop_jobs.sql"));
    await db.exec(CAD_FILES_0018);
    await applyTwice("0108_drop_tenant_inventory.sql");
    await applyTwice("0109_drop_jobs_remnants.sql");
    for (const t of JOB_TABLES) expect(await exists(rows, t), t).toBe(false);
    expect(await fnExists(rows, "public.current_user_role()")).toBe(false);
    expect(await fnExists(rows, "public.current_user_tenant_id()")).toBe(true);
  }, LEGACY_TIMEOUT);

  it("stops without changing anything while the old 0006 cad-files policy still calls a jobs helper", async () => {
    const { db, rows } = await legacyDb({ cadFiles0018: false });
    let error: string | null = null;
    try {
      await db.exec(migration("0109_drop_jobs_remnants.sql"));
    } catch (e) {
      error = (e as Error).message;
    }
    expect(error).toMatch(/0109 stopped, nothing changed: cad_files_select on storage\.objects/);
    expect(await exists(rows, "public.jobs")).toBe(true);
    expect(await fnExists(rows, "public.can_read_cad_object(text)")).toBe(true);
  }, LEGACY_TIMEOUT);
});
