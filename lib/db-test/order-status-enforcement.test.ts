// Order status migration 0113: applies it TWICE inside PGlite (to prove it
// re-runs) on top of the real 0053_order_status_history.sql, on the shared
// Supabase stub — which matters here, because that stub mirrors Supabase's
// DEFAULT PRIVILEGES: a new public function is granted to anon, authenticated
// AND service_role unless the migration revokes it. The grant list is the
// whole access control for the new service-role entry point, so these tests
// would pass trivially without those defaults.
//
// Checks that both entry points share one rule: the super-admin RPC still
// behaves exactly as 0053 defined it, the new service_role RPC applies the
// same validation, and neither the service RPC nor the internal function is
// reachable from the wrong role. Never touches Supabase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migration, pgliteDb, SUPABASE_BASE_STUB, type Who } from "./pglite";

// The parts of 0011 / 0029 / 0042 / 0046 that 0053 builds on, on top of
// SUPABASE_BASE_STUB (auth.users, profiles, is_super_admin, the three roles).
// 0042's part_orders_grant_credits trigger is left out on purpose: 0113 does
// not touch it and it is not what is under test.
const STUB = `
-- order_notification_enqueue reads both of these off profiles.
alter table public.profiles add column email text, add column locale text;

create function public.ai_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then 'anonymous'
              when public.is_super_admin() then 'admin'
              else 'user' end;
$$;

create function public.set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- 0011
create table public.part_orders (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid references public.profiles (id) on delete set null,
  customer_name   text not null default 'Test',
  customer_phone  text not null default '+97400000000',
  customer_email  text,
  delivery_area   text not null default 'Lusail',
  delivery_notes  text,
  status          text not null default 'pending'
                    constraint part_orders_status_check
                    check (status in ('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled')),
  total_qar       numeric(10, 2) not null default 0,
  payment_method  text,
  whatsapp_sent   boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger set_part_orders_updated_at before update on public.part_orders
  for each row execute function public.set_updated_at();
alter table public.part_orders enable row level security;
create policy part_orders_admin_all on public.part_orders for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy part_orders_own_select on public.part_orders for select to authenticated
  using (profile_id = auth.uid());

-- 0029
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  free_wiring_used boolean not null default false,
  cad_regens_remaining integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.demand_signals (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('view', 'add_to_cart', 'request', 'zero_search', 'bom_unmatched')),
  user_id     uuid references auth.users (id) on delete set null,
  source_page text,
  quantity    integer check (quantity is null or quantity >= 1),
  note        text,
  created_at  timestamptz not null default now()
);

-- 0042
create table public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('wiring', 'cad')),
  delta integer not null,
  reason text,
  note text,
  redeemable_until timestamptz,
  redeemed_order_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create function public.credit_balance_of(p_user uuid, p_kind text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from public.credits_ledger
   where user_id = p_user and kind = p_kind;
$$;

-- 0046
create table public.notification_outbox (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  locale      text not null default 'en',
  email       text,
  status      text not null default 'queued',
  attempts    integer not null default 0,
  last_error  text,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create unique index notification_outbox_dedupe
  on public.notification_outbox (user_id, kind, (payload ->> 'ref'));
create function public.notification_enqueue(p_user uuid, p_kind text, p_payload jsonb) returns uuid
language sql security definer set search_path = '' as $$ select null::uuid $$;

create table public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
`;

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const CUSTOMER = "00000000-0000-4000-8000-0000000000a2";
const MISSING = "00000000-0000-4000-8000-00000000dead";

const { db, rows, as, fails, applyTwice } = pgliteDb();

/** A fresh order at `status`, created without firing the status triggers. */
async function newOrder(status = "confirmed"): Promise<string> {
  // The back-fill switch silences the INSERT history row, so every test starts
  // from an order with no history at all.
  await db.exec("select set_config('app.order_status_backfill', 'on', false)");
  const [row] = await rows<{ id: string }>(
    `insert into public.part_orders (profile_id, customer_email, status, total_qar, payment_method)
     values ($1, 'customer@example.com', $2, 120, 'cash') returning id`,
    [CUSTOMER, status],
  );
  await db.exec("select set_config('app.order_status_backfill', '', false)");
  return row.id;
}

type Change = { from: string; to: string };
type Entry = "set_order_status" | "set_order_status_service" | "set_order_status_internal";

const call = (fn: Entry, order: string, status: string | null, note?: string) =>
  rows<Record<string, Change>>(`select public.${fn}($1, $2, $3) as result`, [order, status, note ?? null]);

const refuse = (fn: Entry, order: string, status: string | null, note?: string) =>
  fails(`select public.${fn}($1, $2, $3)`, [order, status, note ?? null]);

const historyOf = (order: string) =>
  rows<{ status: string; note: string | null }>(
    "select status, note from public.order_status_history where order_id = $1 order by changed_at",
    [order],
  );

const statusOf = async (order: string) =>
  (await rows<{ status: string }>("select status from public.part_orders where id = $1", [order]))[0].status;

describe("0113_order_status_one_enforcement_point", () => {
  beforeAll(async () => {
    await db.exec(SUPABASE_BASE_STUB);
    await db.exec(STUB);
    await db.exec(`
      insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
        ('${ADMIN}', 'admin@gestaltung360.com', now(), false),
        ('${CUSTOMER}', 'customer@example.com', now(), false);
      insert into public.profiles (id, role, email, locale) values
        ('${ADMIN}', 'super_admin', 'admin@gestaltung360.com', 'en'),
        ('${CUSTOMER}', 'client', 'customer@example.com', 'en');
    `);
    await db.exec(migration("0053_order_status_history.sql"));
    await applyTwice("0113_order_status_one_enforcement_point.sql");
  }, 60_000);

  afterAll(async () => {
    await db?.close();
  });

  it("keeps the rule in one function and lets neither wrapper repeat it", async () => {
    const [internal] = await rows<{ src: string }>(
      "select prosrc as src from pg_proc where proname = 'set_order_status_internal'",
    );
    expect(internal.src).toContain("order_status_transition_ok");
    for (const fn of ["set_order_status", "set_order_status_service"] as const) {
      const [wrapper] = await rows<{ src: string }>("select prosrc as src from pg_proc where proname = $1", [fn]);
      expect(wrapper.src, fn).toContain("set_order_status_internal");
      expect(wrapper.src, fn).not.toContain("order_status_transition_ok");
    }
  });

  // The same rule, exercised through both entry points.
  describe.each<{ fn: Exclude<Entry, "set_order_status_internal">; who: Who }>([
    { fn: "set_order_status", who: ADMIN },
    { fn: "set_order_status_service", who: "service" },
  ])("$fn", ({ fn, who }) => {
    it("takes a legal forward step and writes exactly one history row with the note", async () => {
      const order = await newOrder("confirmed");
      const result = await as(who, () => call(fn, order, "paid", "  Paid by Fawran.  "));
      expect(result[0].result).toEqual({ from: "confirmed", to: "paid" });
      expect(await statusOf(order)).toBe("paid");
      expect(await historyOf(order)).toEqual([{ status: "paid", note: "Paid by Fawran." }]);
    });

    it("allows skipping steps and cancelling, and refuses going back", async () => {
      const skip = await newOrder("confirmed");
      expect((await as(who, () => call(fn, skip, "shipped")))[0].result).toEqual({
        from: "confirmed",
        to: "shipped",
      });
      expect(await as(who, () => refuse(fn, skip, "paid"))).toMatch(/bad_transition/);

      const cancel = await newOrder("sourcing");
      expect((await as(who, () => call(fn, cancel, "cancelled")))[0].result).toEqual({
        from: "sourcing",
        to: "cancelled",
      });
    });

    it("refuses delivered and cancelled as a starting point", async () => {
      for (const terminal of ["delivered", "cancelled"] as const) {
        const order = await newOrder(terminal);
        expect(await as(who, () => refuse(fn, order, "shipped")), terminal).toMatch(/bad_transition/);
        // Even "any status -> cancelled" stops at a terminal status; from
        // 'cancelled' the same-status check answers first.
        expect(await as(who, () => refuse(fn, order, "cancelled")), `${terminal} -> cancelled`).toMatch(
          terminal === "cancelled" ? /same_status/ : /bad_transition/,
        );
        expect(await statusOf(order), terminal).toBe(terminal);
        expect(await historyOf(order), terminal).toEqual([]);
      }
    });

    it("refuses an unknown status, a null status and an order that is not there", async () => {
      const order = await newOrder("confirmed");
      // 'pending' and 'processing' are the pre-0053 names; they are not valid now.
      for (const bad of ["ready", "pending", "processing", "DELIVERED", "", null]) {
        expect(await as(who, () => refuse(fn, order, bad)), String(bad)).toMatch(/bad_status/);
      }
      expect(await as(who, () => refuse(fn, MISSING, "paid"))).toMatch(/not_found/);
      expect(await statusOf(order)).toBe("confirmed");
    });

    it("refuses the same status again as same_status, not bad_transition", async () => {
      const order = await newOrder("sourcing");
      const msg = await as(who, () => refuse(fn, order, "sourcing"));
      expect(msg).toMatch(/same_status/);
      expect(msg).not.toMatch(/bad_transition/);
      // order_status_transition_ok also says no to from = to; the explicit
      // check runs first, and that is the behaviour 0053 shipped.
      const [ok] = await rows<{ order_status_transition_ok: boolean }>(
        "select public.order_status_transition_ok('sourcing', 'sourcing')",
      );
      expect(ok.order_status_transition_ok).toBe(false);
      expect(await historyOf(order)).toEqual([]);
    });

    it("writes neither the status nor the note when it refuses", async () => {
      const order = await newOrder("paid");
      await as(who, () => refuse(fn, order, "confirmed", "note that must not land"));
      expect(await statusOf(order)).toBe("paid");
      expect(await historyOf(order)).toEqual([]);
    });

    it("still queues the customer status email with the note", async () => {
      const order = await newOrder("confirmed");
      await as(who, () => call(fn, order, "shipped", "On its way."));
      const queued = await rows<{ kind: string; email: string; payload: Record<string, unknown> }>(
        "select kind, email, payload from public.notification_outbox where payload ->> 'ref' = $1",
        [order],
      );
      expect(queued).toHaveLength(1);
      expect(queued[0].kind).toBe("order_shipped");
      expect(queued[0].email).toBe("customer@example.com");
      expect(queued[0].payload.note).toBe("On its way.");
    });
  });

  describe("who may call what", () => {
    it("lets the super admin call set_order_status and refuses a customer and a visitor", async () => {
      const order = await newOrder("confirmed");
      // A signed-in non-admin can execute it (0053 grants it to authenticated)
      // and is turned away by the check inside; anon has no grant at all.
      expect(await as(CUSTOMER, () => refuse("set_order_status", order, "paid"))).toMatch(/not allowed/);
      expect(await as(null, () => refuse("set_order_status", order, "paid"))).toMatch(/permission denied/i);
      expect(await statusOf(order)).toBe("confirmed");
      expect((await as(ADMIN, () => call("set_order_status", order, "paid")))[0].result).toEqual({
        from: "confirmed",
        to: "paid",
      });
    });

    it("grants set_order_status_service to service_role and to nobody else", async () => {
      const order = await newOrder("confirmed");
      for (const who of [CUSTOMER, null] as const) {
        expect(await as(who, () => refuse("set_order_status_service", order, "paid")), String(who)).toMatch(
          /permission denied/i,
        );
      }
      expect(await statusOf(order)).toBe("confirmed");

      // Supabase grants execute to all three roles by default, so the ACL is
      // what keeps this out of PostgREST for a session key.
      const [acl] = await rows<{ roles: string[] }>(`
        select coalesce(array_agg(g.grantee::regrole::text order by g.grantee::regrole::text), '{}') as roles
          from pg_proc p
          left join aclexplode(p.proacl) g on g.privilege_type = 'EXECUTE'
         where p.proname = 'set_order_status_service'
      `);
      expect(acl.roles).toContain("service_role");
      expect(acl.roles).not.toContain("anon");
      expect(acl.roles).not.toContain("authenticated");
      expect(acl.roles).not.toContain("-");
    });

    it("keeps set_order_status_internal out of PostgREST's reach, service_role included", async () => {
      const order = await newOrder("confirmed");
      for (const who of [ADMIN, CUSTOMER, null, "service"] as const) {
        expect(await as(who, () => refuse("set_order_status_internal", order, "paid")), String(who)).toMatch(
          /permission denied/i,
        );
      }
      expect(await statusOf(order)).toBe("confirmed");
    });
  });
});
