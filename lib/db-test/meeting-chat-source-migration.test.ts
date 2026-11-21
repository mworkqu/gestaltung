// Migration 0114 (which AI chat booked a meeting): applied on top of 0113,
// twice, in PGlite. Covers the new column's check, that the 0113 signature is
// gone so PostgREST has no overload to choose between, and that a website
// booking still records no chat. Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const ADMIN = "dddddddd-0000-0000-0000-000000000004";

/** Monday of the week nine days out, 16:00 Qatar. */
const MON = `((date_trunc('week', ((now() at time zone 'Asia/Qatar') + interval '9 days'))::date::text || ' 16:00')::timestamp at time zone 'Asia/Qatar')`;
const WED = `(${MON} + interval '2 days')`;

const STUB = `
${SUPABASE_BASE_STUB}
create table public.store_settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
grant select on public.store_settings to anon, authenticated;
create table public.projects (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id), name text);
create table public.plugin_handoffs (id uuid primary key default gen_random_uuid(), token_hash text not null unique);
create table public.part_orders (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now());
insert into auth.users (id) values ('${ADMIN}');
insert into public.profiles (id, role) values ('${ADMIN}', 'super_admin');
`;

const hash = (tok: string) => `encode(sha256(convert_to('${tok}', 'UTF8')), 'hex')`;

describe("0114 meeting chat source", () => {
  const { db, rows, fails, applyTwice } = pgliteDb();
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await rows<T>(sql, p))[0]!;

  beforeAll(async () => {
    await db.exec(STUB);
    await applyTwice("0113_meetings.sql");
    await applyTwice("0114_meeting_chat_source.sql");
  });

  it("records which chat booked it", async () => {
    const err = await fails(
      `select public.book_meeting(${MON}, 'online', 'Noora', '+97455550001', ${hash("tok-chatgpt-aaaaaaaaaaaaaaaaa")},
        null, 'en', null, null, null, 'plugin', true, 'chatgpt')`,
    );
    expect(err).toBeNull();
    const row = await one<{ chat_source: string; source: string }>("select chat_source, source from public.meeting_bookings");
    expect(row).toMatchObject({ chat_source: "chatgpt", source: "plugin" });
  });

  it("leaves a website booking with no chat, and ignores a bogus chat name", async () => {
    expect(
      await fails(
        `select public.book_meeting(${WED}, 'studio', 'Ali', '+97455550002', ${hash("tok-website-aaaaaaaaaaaaaaaaa")},
          null, 'en', null, null, null, 'website', true)`,
      ),
    ).toBeNull();
    const website = await one<{ chat_source: string | null }>("select chat_source from public.meeting_bookings where name = 'Ali'");
    expect(website.chat_source).toBeNull();

    // An unknown value is stored as null rather than refused, so a new host
    // name can never fail a booking.
    expect(
      await fails(
        `select public.book_meeting(${MON} + interval '7 days', 'online', 'Sara', '+97455550003', ${hash("tok-weird-aaaaaaaaaaaaaaaaaaa")},
          null, 'en', null, null, null, 'plugin', true, 'some-new-assistant')`,
      ),
    ).toBeNull();
    const weird = await one<{ chat_source: string | null }>("select chat_source from public.meeting_bookings where name = 'Sara'");
    expect(weird.chat_source).toBeNull();
  });

  it("refuses a bad value written directly, and leaves exactly one book_meeting", async () => {
    expect(
      await fails(
        `insert into public.meeting_bookings (starts_at, ends_at, mode, name, phone, manage_token_hash, chat_source)
         values (now(), now(), 'online', 'X', '+97455550009', repeat('b', 64), 'telepathy')`,
      ),
    ).toMatch(/chat_source/);

    // One signature only: the 0113 twelve-argument version is dropped.
    const fns = await rows<{ n: number }>(
      "select count(*) n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'book_meeting'",
    );
    expect(Number(fns[0]!.n)).toBe(1);
  });
});
