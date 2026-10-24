// Migration 0100 (audit DB-01): the private Studio product models move to
// project_studio_private (service_role only) and a trigger stops anon /
// authenticated writes from changing studio.product or storing productPrivate.
// Applied TWICE inside PGlite on a stub of projects + its RLS. Never touches Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "@/lib/db-test/pglite";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  studio jsonb,
  studio_version integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
create policy projects_select on public.projects for select using (user_id = auth.uid() or public.is_super_admin());
create policy projects_insert on public.projects for insert with check (user_id = auth.uid());
create policy projects_update on public.projects for update
  using (user_id = auth.uid() or public.is_super_admin()) with check (user_id = auth.uid() or public.is_super_admin());

create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- 0091 shape (the columns 0100 touches); the owner can read their jobs.
create table public.engineering_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid,
  user_id uuid not null,
  snapshot jsonb,
  updated_at timestamptz not null default now()
);
alter table public.engineering_jobs enable row level security;
create policy engineering_jobs_select on public.engineering_jobs for select using (user_id = auth.uid());
`;

const OWNER = "00000000-0000-4000-8000-0000000000c1";
const TEACHER = "00000000-0000-4000-8000-0000000000c2";
const P = "00000000-0000-4000-8000-0000000000d1";
const JOB = "00000000-0000-4000-8000-0000000000e1";
const JOB_CLEAN = "00000000-0000-4000-8000-0000000000e2";
const JOB_ODD = "00000000-0000-4000-8000-0000000000e3";
const OLD = "2026-01-01T00:00:00.000Z";

const product = { designs: [{ id: "d_aaaaaaaaaa", archetype: "box" }], chosenId: null, unlockedId: null, specHash: "h" };
const productPrivate = { designs: [{ id: "d_aaaaaaaaaa", model: { bodies: [{ id: "b" }] }, source: "ai" }] };
const studio = { spec: { name: "Lamp" }, components: [], product, productPrivate };

const { db, rows, as, fails, applyTwice } = pgliteDb();

const forge = (version: number) =>
  db.query(
    `update public.projects
        set studio = jsonb_set(jsonb_set(studio, '{product,unlockedId}', '"d_aaaaaaaaaa"'), '{spec,name}', '"Desk lamp"')
                     || '{"productPrivate":{"designs":[]}}'::jsonb,
            studio_version = $2 + 1
      where id = $1 and studio_version = $2`,
    [P, version],
  );

describe("0100_studio_private", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.query("insert into auth.users (id, email, email_confirmed_at) values ($1, 'o@x.qa', now()), ($2, 't@x.qa', now())", [OWNER, TEACHER]);
    await db.query(
      "insert into public.projects (id, user_id, name, studio, studio_version) values ($1, $2, 'Lamp', $3, 1)",
      [P, OWNER, JSON.stringify(studio)],
    );
    await db.exec("alter table public.projects disable trigger projects_set_updated_at");
    await db.query("update public.projects set updated_at = $1", [OLD]);
    await db.exec("alter table public.projects enable trigger projects_set_updated_at");
    // Jobs submitted before 0100 stored {name, studio: project.studio} verbatim (G1.2).
    await db.query(
      `insert into public.engineering_jobs (id, project_id, user_id, snapshot, updated_at) values
         ($1, $4, $5, $6, $7), ($2, $4, $5, $8, $7), ($3, $4, $5, $9, $7)`,
      [
        JOB, JOB_CLEAN, JOB_ODD, P, OWNER,
        JSON.stringify({ name: "Lamp", studio }),
        OLD,
        JSON.stringify({ name: "Lamp", studio: { spec: studio.spec, product } }),
        JSON.stringify({ name: "Lamp", studio: [1, 2] }),
      ],
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("BEFORE: the owner reads the private models and forges the unlock through PostgREST (the hole)", async () => {
    const [read] = await as(OWNER, () => rows<{ p: unknown }>("select studio->'productPrivate' as p from public.projects where id = $1", [P]));
    expect(read.p).toEqual(productPrivate);
    const r = await as(OWNER, () => forge(1));
    expect(r.affectedRows).toBe(1);
    const [row] = await rows<{ u: string | null }>("select studio#>>'{product,unlockedId}' as u from public.projects where id = $1", [P]);
    expect(row.u).toBe("d_aaaaaaaaaa");
    // put the row back the way it was for the migration
    await db.exec("alter table public.projects disable trigger projects_set_updated_at");
    await db.query("update public.projects set studio = $2, studio_version = 1, updated_at = $3 where id = $1", [P, JSON.stringify(studio), OLD]);
    await db.exec("alter table public.projects enable trigger projects_set_updated_at");
  });

  it("BEFORE (G1.2): the owner reads the private models from an old engineering job snapshot", async () => {
    const [r] = await as(OWNER, () =>
      rows<{ p: unknown }>("select snapshot #> '{studio,productPrivate}' as p from public.engineering_jobs where id = $1", [JOB]),
    );
    expect(r.p).toEqual(productPrivate);
  });

  it("applies twice; back-fills the private table and strips projects.studio without touching updated_at", async () => {
    await applyTwice("0100_studio_private.sql");
    const [priv] = await as("service", () => rows<{ product_private: unknown }>("select product_private from public.project_studio_private where project_id = $1", [P]));
    expect(priv.product_private).toEqual(productPrivate);
    const [row] = await rows<{ has: boolean; product: unknown; updated_at: Date; studio_version: number }>(
      "select studio ? 'productPrivate' as has, studio->'product' as product, updated_at, studio_version from public.projects where id = $1",
      [P],
    );
    expect(row.has).toBe(false);
    expect(row.product).toEqual(product);
    expect(row.updated_at.toISOString()).toBe(OLD);
    expect(row.studio_version).toBe(1);
  });

  it("BEFORE→AFTER (G1.2): old job snapshots lose productPrivate; the rest of the snapshot is untouched", async () => {
    // applyTwice ran in the previous case, so the clean-up is idempotent here too.
    const [job] = await as(OWNER, () =>
      rows<{ s: { name: string; studio: Record<string, unknown> }; updated_at: Date }>(
        "select snapshot as s, updated_at from public.engineering_jobs where id = $1",
        [JOB],
      ),
    );
    expect(job.s).toEqual({ name: "Lamp", studio: { spec: studio.spec, components: [], product } });
    expect(job.updated_at.toISOString()).toBe(OLD);
    const [clean] = await rows<{ s: unknown }>("select snapshot as s from public.engineering_jobs where id = $1", [JOB_CLEAN]);
    expect(clean.s).toEqual({ name: "Lamp", studio: { spec: studio.spec, product } });
    const [odd] = await rows<{ s: unknown }>("select snapshot as s from public.engineering_jobs where id = $1", [JOB_ODD]);
    expect(odd.s).toEqual({ name: "Lamp", studio: [1, 2] });
  });

  it("AFTER: the owner's SELECT of studio->'productPrivate' is null and the private table is denied", async () => {
    const [read] = await as(OWNER, () => rows<{ p: unknown }>("select studio->'productPrivate' as p from public.projects where id = $1", [P]));
    expect(read.p).toBeNull();
    expect(await as(OWNER, () => fails("select * from public.project_studio_private"))).toMatch(/permission denied/);
    expect(await as(null, () => fails("select * from public.project_studio_private"))).toMatch(/permission denied/);
  });

  it("AFTER: an owner PATCH cannot change product.unlockedId or store productPrivate; the rest saves and the version check holds", async () => {
    const r = await as(OWNER, () => forge(1));
    expect(r.affectedRows).toBe(1);
    const [row] = await rows<{ u: string | null; name: string; has: boolean; v: number }>(
      "select studio#>>'{product,unlockedId}' as u, studio#>>'{spec,name}' as name, studio ? 'productPrivate' as has, studio_version as v from public.projects where id = $1",
      [P],
    );
    expect(row).toEqual({ u: null, name: "Desk lamp", has: false, v: 2 });
    // stale version → no row (the doc route answers 409 conflict, as before)
    expect((await as(OWNER, () => forge(1))).affectedRows).toBe(0);
  });

  it("AFTER: an owner INSERT cannot seed product / productPrivate", async () => {
    const id = "00000000-0000-4000-8000-0000000000d2";
    await as(OWNER, () =>
      db.query("insert into public.projects (id, user_id, name, studio) values ($1, $2, 'New', $3)", [
        id,
        OWNER,
        JSON.stringify({ spec: { name: "x" }, product: { ...product, unlockedId: "d_aaaaaaaaaa" }, productPrivate }),
      ]),
    );
    const [row] = await rows<{ s: Record<string, unknown> }>("select studio as s from public.projects where id = $1", [id]);
    expect(row.s).toEqual({ spec: { name: "x" } });
  });

  it("studio_product_save is service_role only and saves doc + models atomically with the version check", async () => {
    expect(await as(OWNER, () => fails("select public.studio_product_save($1, $1, 2, '{}'::jsonb, '{}'::jsonb)", [P]))).toMatch(/permission denied/);
    expect(await as(null, () => fails("select public.studio_product_save($1, $1, 2, '{}'::jsonb, '{}'::jsonb)", [P]))).toMatch(/permission denied/);

    const next = { spec: { name: "Desk lamp" }, components: [], product: { ...product, unlockedId: "d_aaaaaaaaaa" }, productPrivate: { designs: [] } };
    const newPriv = { designs: [{ id: "d_aaaaaaaaaa", model: { bodies: [] }, source: "ai" }] };
    const [stale] = await as("service", () =>
      rows<{ v: number | null }>("select public.studio_product_save($1, $4, 1, $2, $3) as v", [P, JSON.stringify(next), JSON.stringify(newPriv), OWNER]),
    );
    expect(stale.v).toBeNull();
    const [ok] = await as("service", () =>
      rows<{ v: number | null }>("select public.studio_product_save($1, $4, 2, $2, $3) as v", [P, JSON.stringify(next), JSON.stringify(newPriv), OWNER]),
    );
    expect(ok.v).toBe(3);
    const [row] = await rows<{ u: string; has: boolean }>(
      "select studio#>>'{product,unlockedId}' as u, studio ? 'productPrivate' as has from public.projects where id = $1",
      [P],
    );
    expect(row).toEqual({ u: "d_aaaaaaaaaa", has: false });
    const [priv] = await rows<{ p: unknown }>("select product_private as p from public.project_studio_private where project_id = $1", [P]);
    expect(priv.p).toEqual(newPriv);
    // A later owner save keeps the server's unlock.
    await as(OWNER, () => db.query("update public.projects set studio = studio || '{\"product\":null}'::jsonb where id = $1", [P]));
    const [kept] = await rows<{ u: string }>("select studio#>>'{product,unlockedId}' as u from public.projects where id = $1", [P]);
    expect(kept.u).toBe("d_aaaaaaaaaa");
  });

  it("G1.1: a PATCH of studio = null (or a non-object) then {} cannot erase product (regens)", async () => {
    const stored = async () =>
      (await rows<{ p: unknown }>("select studio->'product' as p from public.projects where id = $1", [P]))[0].p;
    const want = await stored();
    expect(want).toBeTruthy();
    await as(OWNER, () => db.query("update public.projects set studio = null where id = $1", [P]));
    expect(await stored()).toEqual(want);
    await as(OWNER, () => db.query("update public.projects set studio = '[]'::jsonb where id = $1", [P]));
    expect(await stored()).toEqual(want);
    await as(OWNER, () => db.query("update public.projects set studio = '{}'::jsonb where id = $1", [P]));
    expect(await stored()).toEqual(want);
  });

  it("G1.3: studio_product_save refuses a non-owner (e.g. a class teacher)", async () => {
    expect(
      await as("service", () => fails("select public.studio_product_save($1, $2, 3, '{}'::jsonb, '{}'::jsonb)", [P, TEACHER])),
    ).toMatch(/not_owner/);
  });
});
