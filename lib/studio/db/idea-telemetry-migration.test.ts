// Ideation-charge telemetry, migration 0106: applies it TWICE inside PGlite (to
// prove it re-runs) on a stub of the objects it builds on — auth.users, profiles,
// is_super_admin(), projects, owns_project() — then checks who may claim a charge,
// the replay guard on a new idea, the quoted-vs-charged halves (declines), who may
// read a row, the clamps and the admin summary. Never touches Supabase.
// Pattern: lib/schools/db/schools-migration.test.ts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${file}`, import.meta.url)), "utf8");

// The parts of 0001 / 0015 that 0106 builds on, nothing more.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;

create table auth.users (id uuid primary key, email text, is_anonymous boolean default false);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.profiles (
  id   uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'client'
);

create function public.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'super_admin' from public.profiles where id = auth.uid()), false);
$$;
grant execute on function public.is_super_admin() to anon, authenticated, service_role;

create table public.projects (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name    text not null
);
alter table public.projects enable row level security;
grant select, insert on public.projects to authenticated;
create policy projects_select on public.projects for select
  using (user_id = auth.uid() or public.is_super_admin());

-- 0015 owns_project(): the owner or a super admin.
create function public.owns_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project_id and (p.user_id = auth.uid() or public.is_super_admin())
  );
$$;
grant execute on function public.owns_project(uuid) to authenticated, anon;
`;

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";
const ADMIN = "00000000-0000-4000-8000-0000000000a3";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const MISSING = "00000000-0000-4000-8000-00000000dead";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function as<T>(user: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user ?? ""]);
  await db.exec(user ? "set role authenticated" : "set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/** The error message of a failing statement, or null when it succeeded. */
async function fails(user: string | null, sql: string, params: unknown[] = []): Promise<string | null> {
  return as(user, async () => {
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  });
}

const CLAIM = "select public.idea_charge_claim($1, $2, $3, $4, $5, $6, $7) as id";
const FILL = "select public.idea_charge_fill($1, $2, $3, $4, $5, $6, $7)";

/** args: project, kind, from, to, estimated, idea_key, stage ('charged' by default). */
const claim = (user: string, args: unknown[]) =>
  as(user, async () => (await rows<{ id: string | null }>(CLAIM, [...args, ...(args.length === 6 ? ["charged"] : [])]))[0].id);

describe("0106_idea_charge_telemetry", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(`
      insert into auth.users (id, email) values
        ('${OWNER}', 'owner@example.com'), ('${OTHER}', 'other@example.com'), ('${ADMIN}', 'admin@gestaltung360.com');
      insert into public.profiles (id, role) values
        ('${OWNER}', 'client'), ('${OTHER}', 'client'), ('${ADMIN}', 'super_admin');
      insert into public.projects (id, user_id, name) values ('${PROJECT}', '${OWNER}', 'Plant buddy');
    `);
    // Twice: the migration must be safe to re-run.
    for (let i = 0; i < 2; i++) await db.exec(migration("0106_idea_charge_telemetry.sql"));
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("an escalation is quoted, then filled in with what the model really consumed", async () => {
    const id = await claim(OWNER, [PROJECT, "escalation", "explorer", "maker", 7, null]);
    expect(id).toBeTruthy();
    // Before the fill: quoted, nothing charged yet.
    const [quoted] = await rows<{ estimated_tokens: number; charged_tokens: number; filled_at: string | null }>(
      "select estimated_tokens, charged_tokens, filled_at from public.idea_charge_telemetry where id = $1",
      [id],
    );
    expect(quoted).toMatchObject({ estimated_tokens: 7, charged_tokens: 0, filled_at: null });

    await as(OWNER, () => rows(FILL, [id, 7, 1200, 300, 0.0004, "gemini-3.5-flash", "model"]));
    const [row] = await rows<Record<string, unknown>>("select * from public.idea_charge_telemetry where id = $1", [id]);
    expect(row).toMatchObject({
      project_id: PROJECT,
      user_id: OWNER,
      kind: "escalation",
      from_tier: "explorer",
      to_tier: "maker",
      estimated_tokens: 7,
      charged_tokens: 7,
      actual_prompt_tokens: 1200,
      actual_completion_tokens: 300,
      actual_total_tokens: 1500,
      model: "gemini-3.5-flash",
      source: "model",
    });
    expect(Number(row.actual_cost_usd)).toBeCloseTo(0.0004);
    expect(row.filled_at).not.toBeNull();
  });

  it("a new product is claimed once: the same idea key never charges twice", async () => {
    const first = await claim(OWNER, [PROJECT, "new_product", "explorer", "engineer", 14, "idea-abc"]);
    expect(first).toBeTruthy();
    // A double click, or a retry after a timeout: no row, so the route charges nothing.
    expect(await claim(OWNER, [PROJECT, "new_product", "explorer", "engineer", 14, "idea-abc"])).toBeNull();
    // A genuinely different idea on the same project is claimed again.
    expect(await claim(OWNER, [PROJECT, "new_product", "explorer", "maker", 7, "idea-xyz"])).toBeTruthy();
    // Escalations carry no key, so they are never blocked by it.
    expect(await claim(OWNER, [PROJECT, "escalation", "maker", "engineer", 7, null])).toBeTruthy();
  });

  it("a shown checkpoint is recorded as a quote, once, and is never filled", async () => {
    const first = await claim(OWNER, [PROJECT, "escalation", "explorer", "maker", 7, "q:abc", "quoted"]);
    expect(first).toBeTruthy();
    // Showing the same checkpoint again writes nothing.
    expect(await claim(OWNER, [PROJECT, "escalation", "explorer", "maker", 7, "q:abc", "quoted"])).toBeNull();
    const [row] = await rows<{ stage: string; charged_tokens: number; estimated_tokens: number }>(
      "select stage, charged_tokens, estimated_tokens from public.idea_charge_telemetry where id = $1",
      [first],
    );
    expect(row).toEqual({ stage: "quoted", charged_tokens: 0, estimated_tokens: 7 });
    // A quote is never turned into a charge in place.
    await as(OWNER, () => rows(FILL, [first, 7, 10, 10, 0.1, "m", "model"]));
    const [after] = await rows<{ stage: string; charged_tokens: number; filled_at: string | null }>(
      "select stage, charged_tokens, filled_at from public.idea_charge_telemetry where id = $1",
      [first],
    );
    expect(after).toEqual({ stage: "quoted", charged_tokens: 0, filled_at: null });
  });

  it("an admin charge is recorded as estimated 14, charged 0", async () => {
    const id = await claim(ADMIN, [PROJECT, "new_idea", "explorer", "engineer", 14, null]);
    await as(ADMIN, () => rows(FILL, [id, 0, 900, 200, null, "gemini-3.5-flash", "cache"]));
    const [row] = await rows<{ estimated_tokens: number; charged_tokens: number; actual_cost_usd: string | null }>(
      "select estimated_tokens, charged_tokens, actual_cost_usd from public.idea_charge_telemetry where source = 'cache'",
    );
    expect(row).toEqual({ estimated_tokens: 14, charged_tokens: 0, actual_cost_usd: null });
  });

  it("someone else's project and an anonymous caller are refused", async () => {
    const args = [PROJECT, "escalation", "explorer", "maker", 7, null, "charged"];
    expect(await fails(OTHER, CLAIM, args)).toMatch(/not_found/);
    expect(await fails(null, CLAIM, args)).toMatch(/sign_in|permission denied/);
    expect(await fails(OWNER, CLAIM, [MISSING, ...args.slice(1)])).toMatch(/not_found/);
  });

  it("another user cannot fill in someone else's row", async () => {
    const id = await claim(OWNER, [PROJECT, "escalation", "explorer", "maker", 7, null]);
    await as(OTHER, () => rows(FILL, [id, 999, 1, 1, 1, "x", "model"]));
    const [row] = await rows<{ charged_tokens: number; filled_at: string | null }>(
      "select charged_tokens, filled_at from public.idea_charge_telemetry where id = $1",
      [id],
    );
    expect(row).toMatchObject({ charged_tokens: 0, filled_at: null });
  });

  it("clamps the numbers and falls back on an unknown kind or tier", async () => {
    const id = await claim(OWNER, [PROJECT, "free_lunch", "platinum", "diamond", 99999, null]);
    await as(OWNER, () => rows(FILL, [id, -5, -1, null, 1e6, null, null]));
    const [row] = await rows<Record<string, unknown>>("select * from public.idea_charge_telemetry where id = $1", [id]);
    expect(row).toMatchObject({
      kind: "new_idea",
      from_tier: "explorer",
      to_tier: "explorer",
      estimated_tokens: 1000,
      charged_tokens: 0,
      actual_prompt_tokens: 0,
      actual_completion_tokens: 0,
    });
    expect(Number(row.actual_cost_usd)).toBe(100);
  });

  it("only a super admin can read the rows", async () => {
    const mine = await as(OWNER, () => rows("select id from public.idea_charge_telemetry"));
    expect(mine).toEqual([]);
    const admin = await as(ADMIN, () => rows("select id from public.idea_charge_telemetry"));
    expect(admin.length).toBeGreaterThan(2);
    expect(await fails(null, "select id from public.idea_charge_telemetry")).toMatch(/permission denied/);
    // No session may write, update or delete a row directly.
    expect(
      await fails(
        OWNER,
        "insert into public.idea_charge_telemetry (kind, from_tier, to_tier, estimated_tokens, charged_tokens) values ('new_idea','explorer','maker',0,0)",
      ),
    ).toMatch(/permission denied/);
    expect(await fails(ADMIN, "delete from public.idea_charge_telemetry")).toMatch(/permission denied/);
  });

  it("the admin summary adds up per tier and refuses everyone else", async () => {
    const summary = await as(ADMIN, () =>
      rows<{
        to_tier: string;
        quoted: number;
        quoted_tokens: number;
        charges: number;
        estimated_tokens: number;
        charged_tokens: number;
      }>("select * from public.admin_idea_charge_summary(30)"),
    );
    // Makers: one checkpoint shown (7 asked for) and three charges claimed — the
    // filled escalation (7 taken), the second new product and the escalation another
    // user failed to fill in. quoted - charges is the decline/walk-away count.
    expect(summary.find((r) => r.to_tier === "maker")).toMatchObject({
      quoted: 1,
      quoted_tokens: 7,
      charges: 3,
      estimated_tokens: 21,
      charged_tokens: 7,
    });
    expect(summary.find((r) => r.to_tier === "engineer")).toMatchObject({ charged_tokens: 0 });
    expect(await fails(OWNER, "select * from public.admin_idea_charge_summary(30)")).toMatch(/not allowed/);
  });

  it("deleting the project takes its telemetry with it", async () => {
    await db.exec(`delete from public.projects where id = '${PROJECT}'`);
    expect(await rows("select id from public.idea_charge_telemetry")).toEqual([]);
  });
});
