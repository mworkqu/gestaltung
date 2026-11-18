// Migration 0110 (consolidation 2026-11, O5): the retired project_claims table
// (0020, retired by 0022) is dropped; its sibling prototyping tables and
// owns_project() keep working. Applies the REAL 0020 on a stub of 0015's
// projects + owns_project(), then 0110 twice. Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, migration, pgliteDb } from "./pglite";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null
);
alter table public.projects enable row level security;
grant select, insert, update, delete on public.projects to authenticated;
create policy projects_select on public.projects for select to authenticated using (user_id = auth.uid());

create function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create function public.owns_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p where p.id = p_project_id and (p.user_id = auth.uid() or public.is_super_admin()));
$$;
`;

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-0000000000b0";
const PROJECT = "00000000-0000-4000-8000-0000000000f1";

const { db, rows, as, fails, applyTwice } = pgliteDb();

describe("0110 drop project_claims", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec(migration("0020_prototyping.sql"));
    await db.exec(`
      insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
      insert into public.projects (id, user_id, name) values ('${PROJECT}', '${ALICE}', 'Lamp');
      insert into public.project_claims (project_id, text) values ('${PROJECT}', 'It is a lamp');
    `);
    await applyTwice("0110_drop_project_claims.sql");
  }, 60_000);

  it("drops the table and its policies", async () => {
    expect((await rows<{ r: string | null }>("select to_regclass('public.project_claims')::text as r"))[0].r).toBeNull();
    expect(await rows("select 1 from pg_policies where tablename = 'project_claims'")).toEqual([]);
  });

  it("keeps owns_project() and the sibling tables working under RLS", async () => {
    expect(await as(ALICE, () => fails(`insert into public.project_parts (project_id, code, name) values ('${PROJECT}', 'P-01', 'Base')`))).toBeNull();
    const mine = await as(ALICE, () => rows<{ name: string }>("select name from public.project_parts"));
    expect(mine.map((r) => r.name)).toEqual(["Base"]);
    expect(await as(BOB, () => rows("select 1 from public.project_parts"))).toEqual([]);
    expect(await as(BOB, () => fails(`insert into public.project_parts (project_id, code, name) values ('${PROJECT}', 'P-02', 'X')`))).toMatch(/row-level security/);
    expect((await rows<{ r: string | null }>("select to_regclass('public.project_schematics')::text as r"))[0].r).not.toBeNull();
  });
});
