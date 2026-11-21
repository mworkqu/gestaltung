// Migration 0113 and lib/meetings must agree. The SQL is the authority (it
// holds the partial unique index); lib/meetings is what the pages, the MCP
// tools and the e-mails use to show times and windows. If the two ever drift, a
// client is offered a slot the database then refuses. Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { canChangeOnline, canSetStatus, creditCheck, MEETING_STATUSES, type MeetingStatus } from "@/lib/meetings/rules";
import { DEFAULT_MEETING_SETTINGS as S } from "@/lib/meetings/settings";
import { freeSlots as tsFreeSlots, slotOnGrid as tsSlotOnGrid } from "@/lib/meetings/slots";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const ADMIN = "dddddddd-0000-0000-0000-000000000004";

/** Monday of the week nine days out, 16:00 Qatar. */
const MON = `((date_trunc('week', ((now() at time zone 'Asia/Qatar') + interval '9 days'))::date::text || ' 16:00')::timestamp at time zone 'Asia/Qatar')`;
const TUE = `(${MON} + interval '1 day')`;
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

describe("0113 meetings — SQL and lib/meetings agree", () => {
  const { db, rows, as, applyTwice } = pgliteDb();
  const one = async <T = Record<string, unknown>>(sql: string, p: unknown[] = []) => (await rows<T>(sql, p))[0]!;
  const nowMs = async () => new Date((await one<{ n: string | Date }>("select now() n")).n).getTime();

  beforeAll(async () => {
    await db.exec(STUB);
    await applyTwice("0113_meetings.sql");
  });

  it("produces the same free slots from the same clock", async () => {
    const now = await nowMs();
    const sql = (await rows<{ s: string | Date }>("select public.meeting_free_slots() s")).map((r) => new Date(r.s).toISOString());
    const ts = tsFreeSlots({ settings: S, nowMs: now, holidays: [], taken: [] });

    expect(sql.length).toBeGreaterThan(0);
    expect(sql).toEqual(ts);
  });

  it("agrees on the slot grid", async () => {
    const cases = [MON, TUE, WED, `${MON} + interval '1 hour'`, `${MON} + interval '30 minutes'`, `${MON} + interval '2 hours'`, `${MON} - interval '1 hour'`, `${MON} + interval '28 days'`];
    for (const expr of cases) {
      const r = await one<{ ok: boolean; t: string | Date }>(`select public.meeting_slot_on_grid(${expr}) ok, ${expr} t`);
      expect(tsSlotOnGrid(new Date(r.t).toISOString(), S, { nowMs: await nowMs() })).toBe(r.ok);
    }
  });

  it("agrees that a holiday closes the day", async () => {
    const day = (await one<{ d: string }>(`select to_char(${MON} at time zone 'Asia/Qatar', 'YYYY-MM-DD') d`)).d;
    await db.exec(
      `insert into public.store_settings (key, value) values ('holidays', jsonb_build_object('weekend','[5,6]'::jsonb,'dates', jsonb_build_array('${day}')))`,
    );
    const r = await one<{ ok: boolean; t: string | Date }>(`select public.meeting_slot_on_grid(${MON}) ok, ${MON} t`);
    expect(r.ok).toBe(false);
    expect(tsSlotOnGrid(new Date(r.t).toISOString(), S, { nowMs: await nowMs(), holidays: [day] })).toBe(false);
    await db.exec("delete from public.store_settings where key = 'holidays'");
  });

  it("agrees on the 24-hour change window", async () => {
    await db.exec(
      `insert into public.meeting_bookings (starts_at, ends_at, mode, name, phone, manage_token_hash, is_test)
       values (now() + interval '1 hour', now() + interval '2 hours', 'online', 'Soon', '+97455500021', ${hash("tok-parity-soon-aaaaaaaaaaaaaa")}, true)`,
    );
    const moved = await one<{ r: { ok: boolean; reason?: string } }>(`select public.move_meeting($1, ${WED}) r`, [
      "tok-parity-soon-aaaaaaaaaaaaaa",
    ]);
    const soon = await one<{ s: string | Date }>("select starts_at s from public.meeting_bookings where name = 'Soon'");

    expect(moved.r).toMatchObject({ ok: false, reason: "too_late" });
    expect(canChangeOnline({ startsAt: new Date(soon.s).toISOString(), status: "booked" }, S, await nowMs())).toBe(false);
    await db.exec("delete from public.meeting_bookings");
  });

  it("agrees on every status transition", async () => {
    for (const from of MEETING_STATUSES) {
      for (const to of MEETING_STATUSES) {
        const { ok } = await one<{ ok: boolean }>(
          `select ($1 = 'booked'   and $2 in ('done','no_show','cancelled'))
               or ($1 = 'done'     and $2 = 'invoiced')
               or ($1 = 'invoiced' and $2 = 'paid') ok`,
          [from, to],
        );
        expect(canSetStatus(from as MeetingStatus, to as MeetingStatus)).toBe(ok);
      }
    }
  });

  it("agrees on the order-credit window", async () => {
    await db.exec(
      `insert into public.meeting_bookings (starts_at, ends_at, mode, name, phone, manage_token_hash, status, is_test)
       values (${MON}, ${MON} + interval '1 hour', 'studio', 'Paid', '+97455500022', ${hash("tok-parity-paid-aaaaaaaaaaaaaa")}, 'paid', true)`,
    );
    const paid = await one<{ id: string; s: string | Date }>("select id, starts_at s from public.meeting_bookings where name = 'Paid'");

    for (const offset of ["interval '3 days'", "interval '30 days'", "interval '45 days'", "-interval '1 day'"]) {
      const ord = await one<{ id: string; c: string | Date }>(
        `insert into public.part_orders (created_at) values (${MON} + ${offset}) returning id, created_at c`,
      );
      await db.exec(`update public.meeting_bookings set credit_order_id = null where id = '${paid.id}'`);

      // apply_meeting_credit is super-admin only, so ask as the owner
      const sqlResult = await as(ADMIN, async () =>
        (await rows<{ r: { ok: boolean; reason?: string } }>("select public.apply_meeting_credit($1, $2) r", [paid.id, ord.id]))[0]!,
      );
      const ts = creditCheck(
        { status: "paid", startsAt: new Date(paid.s).toISOString(), orderCreatedAt: new Date(ord.c).toISOString() },
        S,
      );

      expect(ts.ok).toBe(sqlResult.r.ok);
      if (!ts.ok) expect(sqlResult.r.reason).toBe(ts.reason);
    }
  });
});
