// Migration 0112 (chat-plugin hand-offs): applied TWICE in PGlite on a minimal
// stub of profiles / projects (+ cap trigger) / inquiries (+ the 0073 guard) /
// ai_rate_limits. Covers claim, idempotency, other-user token, expiry, project
// cap, inquiry link, phone flow, RLS and the rate-limit RPC. Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const FULL = "cccccccc-0000-0000-0000-000000000003";
const ADMIN = "dddddddd-0000-0000-0000-000000000004";
const INQ = "11111111-1111-1111-1111-111111111111";

const TOK = "tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOK_EXP = "tok-expired-aaaaaaaaaaaaaaaaaaaa";
const TOK_FULL = "tok-full-aaaaaaaaaaaaaaaaaaaaaa";

const STUB = `
${SUPABASE_BASE_STUB}
alter table public.profiles add column phone text;
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  name text, spec jsonb, studio jsonb, studio_version integer not null default 0,
  status text not null default 'active'
);
create function public.projects_enforce_limit() returns trigger language plpgsql security definer set search_path = '' as $f$
begin
  if (select count(*) from public.projects p where p.user_id = new.user_id and p.status = 'active') >= 3 then
    raise exception 'project_limit';
  end if;
  return new;
end $f$;
create trigger projects_enforce_limit before insert on public.projects for each row execute function public.projects_enforce_limit();
create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null, phone text not null, message text not null,
  project_id uuid references public.projects (id) on delete set null
);
-- 0073 guard: project_id is frozen for anon/authenticated on UPDATE.
create function public.inquiries_guard_quote() returns trigger language plpgsql set search_path = '' as $f$
begin
  if current_user not in ('anon', 'authenticated') then return new; end if;
  new.project_id := old.project_id;
  return new;
end $f$;
create trigger inquiries_guard_quote before update on public.inquiries for each row execute function public.inquiries_guard_quote();
create table public.ai_rate_limits (key text not null, day date not null, hits integer not null default 0, primary key (key, day));
insert into auth.users (id) values ('${A}'), ('${B}'), ('${FULL}'), ('${ADMIN}');
insert into public.profiles (id, role) values ('${A}', 'client'), ('${B}', 'client'), ('${FULL}', 'client'), ('${ADMIN}', 'super_admin');
insert into public.projects (user_id, name) select '${FULL}', 'p' || g from generate_series(1, 3) g;
insert into public.inquiries (id, name, phone, message) values ('${INQ}', 'Lead', '+97400000000', 'hi');
`;

const handoff = (tok: string, opts: { expired?: boolean; inquiry?: boolean } = {}) => `
insert into public.plugin_handoffs (token_hash, source, build, studio_doc, inquiry_id, expires_at)
values (encode(sha256(convert_to('${tok}', 'UTF8')), 'hex'), 'claude', '{"name":"Robot arm"}', '{"v":1,"x":true}',
        ${opts.inquiry ? `'${INQ}'` : "null"}, ${opts.expired ? "now() - interval '1 day'" : "now() + interval '30 days'"});`;

describe("0112 plugin handoffs", () => {
  const { db, rows, as, fails, applyTwice } = pgliteDb();
  const claim = (who: string | null, tok: string) =>
    as(who, async () => (await rows<{ r: Record<string, unknown> }>("select public.claim_plugin_handoff($1) r", [tok]))[0]!.r);
  const setPhone = (who: string | null, tok: string, ph: string) =>
    as(who, async () => (await rows<{ r: Record<string, unknown> }>("select public.plugin_handoff_set_phone($1, $2) r", [tok, ph]))[0]!.r);

  beforeAll(async () => {
    await db.exec(STUB);
    await applyTwice("0112_plugin_handoffs.sql");
    await db.exec(handoff(TOK, { inquiry: true }));
    await db.exec(handoff(TOK_EXP, { expired: true }));
    await db.exec(handoff(TOK_FULL));
  }, 60_000);

  it("anon gets sign_in", async () => {
    expect(await claim(null, TOK)).toEqual({ ok: false, reason: "sign_in" });
  });

  it("unknown, short and expired tokens are bad_token", async () => {
    expect(await claim(A, "nope-nope-nope-nope-nope-nope")).toEqual({ ok: false, reason: "bad_token" });
    expect(await claim(A, "short")).toEqual({ ok: false, reason: "bad_token" });
    expect(await claim(A, TOK_EXP)).toEqual({ ok: false, reason: "bad_token" });
  });

  it("project cap: project_limit, hand-off stays unclaimed", async () => {
    expect(await claim(FULL, TOK_FULL)).toEqual({ ok: false, reason: "project_limit" });
    const r = await rows(
      "select claimed_by, project_id from public.plugin_handoffs where token_hash = encode(sha256(convert_to($1,'UTF8')),'hex')",
      [TOK_FULL],
    );
    expect(r).toEqual([{ claimed_by: null, project_id: null }]);
  });

  let projectId = "";
  it("A claims: one project, studio copied, inquiry linked, needs_phone", async () => {
    const r = await claim(A, TOK);
    expect(r.ok).toBe(true);
    expect(r.already).toBe(false);
    expect(r.needs_phone).toBe(true);
    projectId = r.project_id as string;
    const p = await rows<{ name: string; studio: unknown; studio_version: number; spec: { aiConsent: { destination: string; source: string } } }>(
      "select name, studio, studio_version, spec from public.projects where user_id = $1",
      [A],
    );
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ name: "Robot arm", studio: { v: 1, x: true }, studio_version: 1 });
    expect(p[0]!.spec.aiConsent).toMatchObject({ destination: "studio", source: "plugin" });
    expect(await rows("select project_id from public.inquiries")).toEqual([{ project_id: projectId }]);
  });

  it("A claims again: same project, already, still one", async () => {
    expect(await claim(A, TOK)).toMatchObject({ ok: true, project_id: projectId, already: true });
    expect(await rows("select 1 from public.projects where user_id = $1", [A])).toHaveLength(1);
  });

  it("B with the same token gets bad_token", async () => {
    expect(await claim(B, TOK)).toEqual({ ok: false, reason: "bad_token" });
  });

  it("phone: refused for B and for a bad format, saved for A", async () => {
    expect(await setPhone(B, TOK, "+97455551234")).toEqual({ ok: false, reason: "bad_token" });
    expect(await setPhone(A, TOK, "55551234")).toEqual({ ok: false, reason: "bad_phone" });
    expect(await setPhone(A, TOK, "+97455551234")).toEqual({ ok: true });
    expect(await rows("select phone from public.profiles where id = $1", [A])).toEqual([{ phone: "+97455551234" }]);
    expect(await rows("select phone from public.inquiries")).toEqual([{ phone: "+97455551234" }]);
    expect(await rows("select contact_phone from public.plugin_handoffs where claimed_by = $1", [A])).toEqual([
      { contact_phone: "+97455551234" },
    ]);
    expect(await claim(A, TOK)).toMatchObject({ ok: true, already: true, needs_phone: false });
  });

  it("RLS: anon / user cannot read hand-offs, super admin can", async () => {
    await as(null, async () => {
      expect(await fails("select * from public.plugin_handoffs")).toMatch(/permission denied/);
    });
    await as(A, async () => {
      expect(await rows("select id from public.plugin_handoffs")).toHaveLength(0);
    });
    await as(ADMIN, async () => {
      expect(await rows("select id from public.plugin_handoffs")).toHaveLength(3);
    });
  });

  it("plugin_rate_hit: third hit over a limit of 2 is refused; sessions cannot call it", async () => {
    const hit = () =>
      as("service", async () => (await rows<{ r: Record<string, unknown> }>("select public.plugin_rate_hit('mcp:read:x:1', 2) r"))[0]!.r);
    expect(await hit()).toEqual({ allowed: true, hits: 1, limit: 2 });
    expect(await hit()).toEqual({ allowed: true, hits: 2, limit: 2 });
    expect(await hit()).toEqual({ allowed: false, hits: 3, limit: 2 });
    await as(A, async () => {
      expect(await fails("select public.plugin_rate_hit('k', 1)")).toMatch(/permission denied/);
    });
    await as(null, async () => {
      expect(await fails("select public.plugin_rate_hit('k', 1)")).toMatch(/permission denied/);
    });
  });
});
