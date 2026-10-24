// Migration 0101 (audit DB-02): log_ai_usage is server-only, the new
// log_ai_usage_server clamps every number, ai_usage_totals is not for anon.
// Applied TWICE inside PGlite on a stub of ai_usage + the 0031/0088 functions
// (with their original grants, plus Supabase's default privileges). Never
// touches Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "@/lib/db-test/pglite";

const STUB = `
${SUPABASE_BASE_STUB}
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  is_test boolean not null default false
);
create function public.owns_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.projects p where p.id = p_project_id and (p.user_id = auth.uid() or public.is_super_admin()));
$$;

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null, model text,
  project_id uuid references public.projects (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null check (feature in ('analyse', 'netlist', 'transcribe', 'electronics', 'firmware', 'cad', 'studio', 'billing')),
  prompt_tokens integer, completion_tokens integer, total_tokens integer,
  audio_seconds numeric(10, 2), latency_ms integer,
  outcome text not null check (outcome in ('ok', 'error', 'blocked')),
  error_code text, remaining_requests integer, remaining_tokens integer,
  is_test boolean not null default false, anon_key text, cost_usd numeric(12, 6), step text
);
alter table public.ai_usage enable row level security;

-- 0031 (13 args)
create function public.log_ai_usage(
  p_provider text, p_model text, p_project uuid, p_feature text,
  p_prompt_tokens integer, p_completion_tokens integer, p_total_tokens integer,
  p_audio_seconds numeric, p_latency_ms integer, p_outcome text, p_error_code text,
  p_remaining_requests integer, p_remaining_tokens integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_usage (provider, model, project_id, user_id, feature, prompt_tokens, completion_tokens,
    total_tokens, audio_seconds, latency_ms, outcome, error_code, remaining_requests, remaining_tokens)
  values (left(p_provider, 40), left(p_model, 80),
    case when p_project is not null and public.owns_project(p_project) then p_project end,
    auth.uid(), p_feature, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_audio_seconds, p_latency_ms, p_outcome, left(p_error_code, 60), p_remaining_requests, p_remaining_tokens);
end $$;
revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) from public;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer) to authenticated;

-- 0088 (15 args)
create function public.log_ai_usage(
  p_provider text, p_model text, p_project uuid, p_feature text,
  p_prompt_tokens integer, p_completion_tokens integer, p_total_tokens integer,
  p_audio_seconds numeric, p_latency_ms integer, p_outcome text, p_error_code text,
  p_remaining_requests integer, p_remaining_tokens integer,
  p_step text, p_cost_usd numeric
) returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.ai_usage (provider, model, project_id, user_id, feature, prompt_tokens, completion_tokens,
    total_tokens, audio_seconds, latency_ms, outcome, error_code, remaining_requests, remaining_tokens, step, cost_usd)
  values (left(p_provider, 40), left(p_model, 80),
    case when p_project is not null and public.owns_project(p_project) then p_project end,
    auth.uid(), p_feature, p_prompt_tokens, p_completion_tokens, p_total_tokens,
    p_audio_seconds, p_latency_ms, p_outcome, left(p_error_code, 60), p_remaining_requests, p_remaining_tokens,
    left(p_step, 40), case when p_cost_usd is null then null else greatest(0, least(p_cost_usd, 100)) end);
end $$;
revoke all on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric) from public;
grant execute on function public.log_ai_usage(text, text, uuid, text, integer, integer, integer, numeric, integer, text, text, integer, integer, text, numeric) to authenticated;

create function public.ai_usage_totals(p_provider text, p_since timestamptz)
returns table (requests bigint, tokens bigint, audio_seconds numeric)
language sql security definer set search_path = '' stable as $$
  select count(*)::bigint, coalesce(sum(total_tokens), 0)::bigint, coalesce(sum(u.audio_seconds), 0)
    from public.ai_usage u
   where u.provider = p_provider and u.created_at >= p_since and u.outcome in ('ok', 'error') and not u.is_test;
$$;
revoke all on function public.ai_usage_totals(text, timestamptz) from public;
grant execute on function public.ai_usage_totals(text, timestamptz) to authenticated;
`;

const USER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
const PROJ = "00000000-0000-4000-8000-0000000000f1";
const TEST_PROJ = "00000000-0000-4000-8000-0000000000f2";

const OLD13 = "select public.log_ai_usage('gemini', null, null, 'analyse', null, null, 2000000000, null, null, 'ok', null, null, null)";
const OLD15 = "select public.log_ai_usage('gemini', null, null, 'analyse', null, null, 2000000000, null, null, 'ok', null, null, null, null, 100)";
const TOTALS = "select tokens from public.ai_usage_totals('gemini', now() - interval '1 day')";
const server = (user: string | null, project: string | null, total: number, cost: number, audio = 0) =>
  `select public.log_ai_usage_server(${user ? `'${user}'` : "null"}, 'gemini', 'm', ${project ? `'${project}'` : "null"}, 'studio',
     ${total}, ${total}, ${total}, ${audio}, -5, 'ok', null, null, null, 'spec', ${cost})`;

const { db, rows, as, fails, applyTwice } = pgliteDb();

describe("0101_ai_usage_server_only", () => {
  beforeAll(async () => {
    await db.exec(STUB);
    await db.exec(`
      insert into auth.users (id, email) values ('${USER}', 'u@x.qa'), ('${OTHER}', 'o@x.qa');
      insert into public.projects (id, user_id, is_test) values ('${PROJ}', '${USER}', false), ('${TEST_PROJ}', '${USER}', true);
    `);
  }, 60_000);

  afterAll(async () => {
    await db.close();
  });

  it("BEFORE: a guest session (and anon, via default privileges) can log 2e9 tokens and trip the quota", async () => {
    expect(await as(USER, () => fails(OLD15))).toBeNull();
    expect(await as(USER, () => fails(OLD13))).toBeNull();
    expect(await as(null, () => fails(TOTALS))).toBeNull(); // anon reads the totals today
    const [t] = await rows<{ tokens: string }>(TOTALS);
    expect(Number(t.tokens)).toBe(4_000_000_000);
    await db.exec("delete from public.ai_usage");
  });

  it("applies twice", async () => {
    await applyTwice("0101_ai_usage_server_only.sql");
  });

  it("AFTER: authenticated and anon EXECUTE on both old overloads is denied", async () => {
    for (const who of [USER, null]) {
      expect(await as(who, () => fails(OLD13))).toMatch(/permission denied/);
      expect(await as(who, () => fails(OLD15))).toMatch(/permission denied/);
      expect(await as(who, () => fails(server(USER, null, 1, 0)))).toMatch(/permission denied/);
    }
    expect(await rows("select 1 from public.ai_usage")).toHaveLength(0);
  });

  it("AFTER: anon cannot read ai_usage_totals; a session still can (quota())", async () => {
    expect(await as(null, () => fails(TOTALS))).toMatch(/permission denied/);
    expect(await as(USER, () => fails(TOTALS))).toBeNull();
  });

  it("log_ai_usage_server: service only, user required, numbers clamped, project only when owned, is_test copied", async () => {
    expect(await as("service", () => fails(server(null, null, 1, 0)))).toMatch(/user_required/);
    await as("service", () => db.exec(server(USER, PROJ, 2_000_000_000, 1_000, 99_999)));
    await as("service", () => db.exec(server(OTHER, PROJ, 10, -3)));
    await as("service", () => db.exec(server(USER, TEST_PROJ, 10, 0.5)));
    const r = await rows<{ user_id: string; project_id: string | null; total_tokens: number; prompt_tokens: number; cost_usd: string; audio_seconds: string; latency_ms: number; is_test: boolean }>(
      "select user_id, project_id, total_tokens, prompt_tokens, cost_usd, audio_seconds, latency_ms, is_test from public.ai_usage order by total_tokens desc, is_test",
    );
    expect(r[0]).toMatchObject({ user_id: USER, project_id: PROJ, total_tokens: 2_000_000, prompt_tokens: 2_000_000, latency_ms: 0, is_test: false });
    expect(Number(r[0].cost_usd)).toBe(50);
    expect(Number(r[0].audio_seconds)).toBe(3600);
    const other = r.find((x) => x.user_id === OTHER)!;
    expect(other.project_id).toBeNull(); // not their project
    expect(Number(other.cost_usd)).toBe(0);
    expect(r.find((x) => x.project_id === TEST_PROJ)!.is_test).toBe(true);
    const [t] = await rows<{ tokens: string }>(TOTALS);
    expect(Number(t.tokens)).toBe(2_000_010); // the test-project row is not counted
  });
});
