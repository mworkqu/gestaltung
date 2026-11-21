// Migration 0113 (paid engineer meetings): applied TWICE in PGlite on a minimal
// stub of store_settings / projects / plugin_handoffs / part_orders. Covers the
// seeded settings, the slot grid (weekday, time, holiday, horizon), free slots,
// double booking, the notice window, the per-phone cap, cancel and move windows,
// forward-only status transitions, the order credit, and RLS. Never touches Supabase.
import { beforeAll, describe, expect, it } from "vitest";

import { canChangeOnline, canSetStatus, creditCheck, type MeetingStatus } from "@/lib/meetings/rules";
import { DEFAULT_MEETING_SETTINGS } from "@/lib/meetings/settings";
import { freeSlots as tsFreeSlots, slotOnGrid as tsSlotOnGrid } from "@/lib/meetings/slots";

import { SUPABASE_BASE_STUB, pgliteDb } from "./pglite";

const ADMIN = "dddddddd-0000-0000-0000-000000000004";
const USER = "aaaaaaaa-0000-0000-0000-000000000001";

/** Monday of the week nine days out, 16:00 Qatar: inside the 21-day horizon, past the 24 h notice. */
const MON = `((date_trunc('week', ((now() at time zone 'Asia/Qatar') + interval '9 days'))::date::text || ' 16:00')::timestamp at time zone 'Asia/Qatar')`;
const TUE = `(${MON} + interval '1 day')`;
const WED = `(${MON} + interval '2 days')`;

const STUB = `
${SUPABASE_BASE_STUB}
create table public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
grant select on public.store_settings to anon, authenticated;
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id),
  name text
);
create table public.plugin_handoffs (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique
);
create table public.part_orders (
  id uuid primary key default gen_random_uuid(),
  total_qar numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);
insert into auth.users (id) values ('${USER}'), ('${ADMIN}');
insert into public.profiles (id, role) values ('${USER}', 'client'), ('${ADMIN}', 'super_admin');
`;

const hash = (tok: string) => `encode(sha256(convert_to('${tok}', 'UTF8')), 'hex')`;

describe("0113 meetings", () => {
  const { db, rows, as, fails, applyTwice } = pgliteDb();

  const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await rows<T>(sql, params))[0]!;
  const grid = async (expr: string) => (await one<{ ok: boolean }>(`select public.meeting_slot_on_grid(${expr}) ok`)).ok;
  /** Slot start times as ISO strings — comparing Date objects by identity never matches. */
  const freeSlots = async (from: string | null = null, days: number | null = null) =>
    (await rows<{ s: string | Date }>("select public.meeting_free_slots($1, $2) s", [from, days])).map((r) =>
      new Date(r.s).toISOString(),
    );
  /** Resolve an SQL timestamp expression (MON / TUE / WED) to an ISO string. */
  const iso = async (expr: string) => new Date((await one<{ t: string | Date }>(`select ${expr} t`)).t).toISOString();
  const book = (expr: string, tok: string, phone = "+97455500001", extra = "") =>
    fails(
      `select public.book_meeting(${expr}, 'online', 'Test Client', '${phone}', ${hash(tok)}, null, 'en', null, null, null, 'website', true${extra})`,
    );

  beforeAll(async () => {
    await db.exec(STUB);
    await applyTwice("0113_meetings.sql");
  });

  // ── settings ───────────────────────────────────────────────────────────────
  it("seeds store_settings.meetings once and keeps the owner's edits", async () => {
    const r = await one<{ value: Record<string, unknown> }>("select value from public.store_settings where key = 'meetings'");
    expect(r.value).toMatchObject({ weekdays: [1, 3], start: "16:00", end: "18:00", price_qar: 150, min_notice_hours: 24 });

    // an owner edit survives a re-run (insert ... on conflict do nothing)
    await db.exec(`update public.store_settings set value = value || '{"price_qar": 200}'::jsonb where key = 'meetings'`);
    await applyTwice("0113_meetings.sql");
    const after = await one<{ p: number }>("select (value ->> 'price_qar')::numeric p from public.store_settings where key = 'meetings'");
    expect(Number(after.p)).toBe(200);
    await db.exec(`update public.store_settings set value = value || '{"price_qar": 150}'::jsonb where key = 'meetings'`);
  });

  it("meeting_settings() fills defaults in for a partial row", async () => {
    await db.exec(`update public.store_settings set value = '{"price_qar": 150}'::jsonb where key = 'meetings'`);
    const r = await one<{ cfg: Record<string, unknown> }>("select public.meeting_settings() cfg");
    expect(r.cfg).toMatchObject({ weekdays: [1, 3], start: "16:00", end: "18:00", slot_minutes: 60, horizon_days: 21 });
    await db.exec(
      `update public.store_settings set value = '{"timezone":"Asia/Qatar","weekdays":[1,3],"start":"16:00","end":"18:00","slot_minutes":60,"price_qar":150,"min_notice_hours":24,"horizon_days":21,"cancel_free_hours":24,"order_credit_days":30,"modes":["online","studio"]}'::jsonb where key = 'meetings'`,
    );
  });

  // ── the slot grid ──────────────────────────────────────────────────────────
  it("accepts Monday and Wednesday at 16:00 and 17:00 only", async () => {
    expect(await grid(MON)).toBe(true);
    expect(await grid(WED)).toBe(true);
    expect(await grid(`${MON} + interval '1 hour'`)).toBe(true); // 17:00 fits
    expect(await grid(TUE)).toBe(false); // wrong weekday
    expect(await grid(`${MON} + interval '30 minutes'`)).toBe(false); // off the grid
    expect(await grid(`${MON} + interval '2 hours'`)).toBe(false); // 18:00, does not fit before closing
    expect(await grid(`${MON} - interval '1 hour'`)).toBe(false); // 15:00, before opening
  });

  it("refuses a holiday and anything past the horizon", async () => {
    expect(await grid(`${MON} + interval '28 days'`)).toBe(false); // beyond horizon_days

    await db.exec(
      `insert into public.store_settings (key, value) values ('holidays', jsonb_build_object('weekend', '[5,6]'::jsonb, 'dates', jsonb_build_array(to_char(${MON} at time zone 'Asia/Qatar', 'YYYY-MM-DD'))))`,
    );
    expect(await grid(MON)).toBe(false);
    expect(await grid(WED)).toBe(true);
    await db.exec("delete from public.store_settings where key = 'holidays'");
    expect(await grid(MON)).toBe(true);
  });

  // ── free slots ─────────────────────────────────────────────────────────────
  it("lists only on-grid future slots, ordered, and clamps the day count", async () => {
    const slots = await freeSlots();
    expect(slots.length).toBeGreaterThan(0);

    const checked = await rows<{ bad: number }>(
      `select count(*) bad from public.meeting_free_slots() s
        where not public.meeting_slot_on_grid(s)
           or s < now() + interval '24 hours'`,
    );
    expect(Number(checked[0]!.bad)).toBe(0);
    expect(slots).toEqual([...slots].sort()); // ISO strings sort chronologically

    // p_days is clamped to horizon_days, so asking for a year returns no more
    expect((await freeSlots(null, 999)).length).toBe(slots.length);
  });

  it("hides a slot once it is booked and shows it again after a cancel", async () => {
    const slot = await iso(MON);
    expect(await freeSlots()).toContain(slot);

    expect(await book(MON, "tok-free-slots-aaaaaaaaaaaaaaaa")).toBeNull();
    expect(await freeSlots()).not.toContain(slot);

    const r = await one<{ r: { ok: boolean } }>("select public.cancel_meeting($1) r", ["tok-free-slots-aaaaaaaaaaaaaaaa"]);
    expect(r.r.ok).toBe(true);
    expect(await freeSlots()).toContain(slot);
    await db.exec("delete from public.meeting_bookings");
  });

  // ── booking ────────────────────────────────────────────────────────────────
  it("books one meeting and refuses a second in the same slot", async () => {
    expect(await book(MON, "tok-book-one-aaaaaaaaaaaaaaaaaa")).toBeNull();
    const row = await one<{ status: string; mode: string; invoice_qar: string; ends_at: string; starts_at: string }>(
      "select status, mode, invoice_qar, starts_at, ends_at from public.meeting_bookings",
    );
    expect(row.status).toBe("booked");
    expect(Number(row.invoice_qar)).toBe(150);
    expect(new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()).toBe(60 * 60 * 1000);

    expect(await book(MON, "tok-book-two-aaaaaaaaaaaaaaaaaa", "+97455500002")).toMatch(/slot_taken/);
    await db.exec("delete from public.meeting_bookings");
  });

  it("refuses a bad slot, too little notice, an unknown mode and a fourth future meeting", async () => {
    expect(await book(TUE, "tok-bad-slot-aaaaaaaaaaaaaaaaaa")).toMatch(/bad_slot/);

    // on the grid but inside the 24 h notice window: widen the grid so "soon" is valid
    await db.exec(
      `update public.store_settings set value = value || '{"weekdays":[1,2,3,4,5,6,7],"start":"00:00","end":"23:00"}'::jsonb where key = 'meetings'`,
    );
    expect(
      await book(`date_trunc('hour', now()) + interval '2 hours'`, "tok-too-soon-aaaaaaaaaaaaaaaaaa"),
    ).toMatch(/too_soon/);
    await db.exec(
      `update public.store_settings set value = value || '{"weekdays":[1,3],"start":"16:00","end":"18:00"}'::jsonb where key = 'meetings'`,
    );

    expect(
      await fails(
        `select public.book_meeting(${MON}, 'phone_call', 'Test Client', '+97455500009', ${hash("tok-bad-mode-aaaaaaaaaaaaaaaaaa")}, null, 'en', null, null, null, 'website', true)`,
      ),
    ).toMatch(/bad_slot/);

    // two future meetings per phone is the cap
    expect(await book(MON, "tok-cap-one-aaaaaaaaaaaaaaaaaaa", "+97455500003")).toBeNull();
    expect(await book(WED, "tok-cap-two-aaaaaaaaaaaaaaaaaaa", "+97455500003")).toBeNull();
    expect(await book(`${MON} + interval '7 days'`, "tok-cap-three-aaaaaaaaaaaaaaaaa", "+97455500003")).toMatch(/too_many/);
    await db.exec("delete from public.meeting_bookings");
  });

  // ── cancel and move ────────────────────────────────────────────────────────
  it("cancels until 24 h before, then refuses with too_late", async () => {
    const cancel = (tok: string) => one<{ r: { ok: boolean; reason?: string; already?: boolean } }>("select public.cancel_meeting($1) r", [tok]);

    expect(await book(MON, "tok-cancel-ok-aaaaaaaaaaaaaaaa")).toBeNull();
    expect((await cancel("tok-cancel-ok-aaaaaaaaaaaaaaaa")).r).toMatchObject({ ok: true, already: false });
    expect((await cancel("tok-cancel-ok-aaaaaaaaaaaaaaaa")).r).toMatchObject({ ok: true, already: true });
    expect((await cancel("tok-nothing-aaaaaaaaaaaaaaaaaaa")).r).toMatchObject({ ok: false, reason: "bad_token" });

    // a meeting that starts in an hour is past the free-cancel window
    await db.exec(
      `insert into public.meeting_bookings (starts_at, ends_at, mode, name, phone, manage_token_hash, is_test)
       values (now() + interval '1 hour', now() + interval '2 hours', 'studio', 'Soon', '+97455500004', ${hash("tok-too-late-aaaaaaaaaaaaaaaaaa")}, true)`,
    );
    expect((await cancel("tok-too-late-aaaaaaaaaaaaaaaaaa")).r).toMatchObject({ ok: false, reason: "too_late" });
    await db.exec("delete from public.meeting_bookings");
  });

  it("moves a meeting to a free slot and refuses a taken one", async () => {
    const move = (tok: string, expr: string) =>
      one<{ r: { ok: boolean; reason?: string } }>(`select public.move_meeting($1, ${expr}) r`, [tok]);

    expect(await book(MON, "tok-move-me-aaaaaaaaaaaaaaaaaa")).toBeNull();
    expect((await move("tok-move-me-aaaaaaaaaaaaaaaaaa", WED)).r).toMatchObject({ ok: true });
    expect(
      (await one<{ n: number }>(`select count(*) n from public.meeting_bookings where starts_at = ${WED}`)).n,
    ).toBeDefined();

    expect((await move("tok-move-me-aaaaaaaaaaaaaaaaaa", TUE)).r).toMatchObject({ ok: false, reason: "bad_slot" });

    // another meeting holds Monday now
    expect(await book(MON, "tok-move-other-aaaaaaaaaaaaaaa", "+97455500005")).toBeNull();
    expect((await move("tok-move-me-aaaaaaaaaaaaaaaaaa", MON)).r).toMatchObject({ ok: false, reason: "slot_taken" });
    await db.exec("delete from public.meeting_bookings");
  });

  // ── owner actions ──────────────────────────────────────────────────────────
  it("moves status forward only, and only for a super admin", async () => {
    expect(await book(MON, "tok-status-aaaaaaaaaaaaaaaaaaa")).toBeNull();
    const id = (await one<{ id: string }>("select id from public.meeting_bookings")).id;
    const setStatus = (who: string | null, status: string) =>
      as(who, async () =>
        (await rows<{ r: { ok: boolean; reason?: string } }>("select public.set_meeting_status($1, $2, null) r", [id, status]))[0]!.r,
      );

    // a signed-in client may call it and is refused inside; anon may not call it at all
    expect(await setStatus(USER, "done")).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await as(null, () => fails("select public.set_meeting_status($1, 'done', null)", [id]))).toMatch(/permission denied/i);

    expect(await setStatus(ADMIN, "paid")).toMatchObject({ ok: false, reason: "bad_transition" });
    expect(await setStatus(ADMIN, "done")).toMatchObject({ ok: true });
    expect(await setStatus(ADMIN, "booked")).toMatchObject({ ok: false, reason: "bad_transition" });
    expect(await setStatus(ADMIN, "invoiced")).toMatchObject({ ok: true });
    expect(await setStatus(ADMIN, "paid")).toMatchObject({ ok: true });

    const row = await one<{ invoiced_at: string | null; paid_at: string | null }>(
      "select invoiced_at, paid_at from public.meeting_bookings where id = $1",
      [id],
    );
    expect(row.invoiced_at).not.toBeNull();
    expect(row.paid_at).not.toBeNull();
  });

  it("applies the order credit once, only for a paid meeting inside the window", async () => {
    const id = (await one<{ id: string }>("select id from public.meeting_bookings where status = 'paid'")).id;
    const order = async (offset: string) =>
      (await one<{ id: string }>(`insert into public.part_orders (created_at) values (${offset}) returning id`)).id;
    const apply = (who: string | null, meeting: string, ord: string) =>
      as(who, async () =>
        (await rows<{ r: { ok: boolean; reason?: string; credit_qar?: number } }>("select public.apply_meeting_credit($1, $2) r", [meeting, ord]))[0]!.r,
      );

    const late = await order(`${MON} + interval '45 days'`);
    const good = await order(`${MON} + interval '3 days'`);
    const second = await order(`${MON} + interval '4 days'`);

    expect(await apply(USER, id, good)).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await apply(ADMIN, id, late)).toMatchObject({ ok: false, reason: "out_of_window" });
    expect(await apply(ADMIN, id, good)).toMatchObject({ ok: true, credit_qar: 150 });
    // idempotent for the same order, refused for a different one
    expect(await apply(ADMIN, id, good)).toMatchObject({ ok: true, already: true });
    expect(await apply(ADMIN, id, second)).toMatchObject({ ok: false, reason: "already_used" });

    // an unpaid meeting earns nothing
    await db.exec(
      `insert into public.meeting_bookings (starts_at, ends_at, mode, name, phone, manage_token_hash, status, is_test)
       values (${WED}, ${WED} + interval '1 hour', 'online', 'Unpaid', '+97455500006', ${hash("tok-unpaid-aaaaaaaaaaaaaaaaaaa")}, 'done', true)`,
    );
    const unpaid = (await one<{ id: string }>("select id from public.meeting_bookings where name = 'Unpaid'")).id;
    expect(await apply(ADMIN, unpaid, good)).toMatchObject({ ok: false, reason: "not_paid" });
  });

  // ── RLS ────────────────────────────────────────────────────────────────────
  it("hides the table from anon and clients, shows it to a super admin", async () => {
    expect(await as(null, () => fails("select * from public.meeting_bookings"))).toMatch(/permission denied/i);
    expect(await as(USER, async () => (await rows("select * from public.meeting_bookings")).length)).toBe(0);
    expect(await as(ADMIN, async () => (await rows("select * from public.meeting_bookings")).length)).toBeGreaterThan(0);

    // nobody but the server may book or write directly
    expect(await as(null, () => fails(`select public.book_meeting(${MON}, 'online', 'X', '+97455500007', ${hash("tok-anon-aaaaaaaaaaaaaaaaaaaaa")})`))).toMatch(
      /permission denied/i,
    );
    expect(await as(USER, () => fails("insert into public.meeting_bookings (starts_at, ends_at, mode, name, phone, manage_token_hash) values (now(), now(), 'online', 'X', '+97455500008', repeat('a', 64))"))).toMatch(
      /permission denied/i,
    );

    // the free-slot list stays open to anon, and leaks no personal data
    const anonSlots = await as(null, async () => (await rows("select public.meeting_free_slots() s")).length);
    expect(anonSlots).toBeGreaterThan(0);
  });
});
