// School classes migration 0096: applies it TWICE inside PGlite (to prove it
// re-runs) on a stub of the objects it builds on — auth.users, profiles,
// is_super_admin(), ai_role(), projects + its RLS, credits_ledger,
// credit_balance_of(), credit_next_earned_at(), store_settings — then checks
// the join flow, RLS, the credit routing to the teacher and the project cap.
// Never touches Supabase.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

const migration = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../../supabase/migrations/${file}`, import.meta.url)), "utf8");

// The parts of 0001 / 0015 / 0042 that 0096 builds on, nothing more.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean default false
);

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

-- 0042 ai_role()
create function public.ai_role() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then return 'anonymous'; end if;
  if public.is_super_admin() then return 'admin'; end if;
  if exists (
    select 1 from auth.users u
     where u.id = auth.uid()
       and u.email_confirmed_at is not null
       and not coalesce(u.is_anonymous, false)
  ) then return 'user'; end if;
  return 'anonymous';
end $$;
grant execute on function public.ai_role() to anon, authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  spec jsonb,
  studio jsonb,
  studio_version integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  free_wiring_used boolean not null default false,
  cad_regens_remaining integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.projects enable row level security;
grant select, insert, update, delete on public.projects to authenticated;
create policy projects_select on public.projects for select
  using (user_id = auth.uid() or public.is_super_admin());
create policy projects_insert on public.projects for insert
  with check (user_id = auth.uid());
create policy projects_update on public.projects for update
  using (user_id = auth.uid() or public.is_super_admin())
  with check (user_id = auth.uid() or public.is_super_admin());

create table public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('wiring', 'cad')),
  delta integer not null,
  reason text,
  redeemable_until timestamptz,
  redeemed_order_id uuid,
  earned_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.credits_ledger enable row level security;
grant select on public.credits_ledger to authenticated;
create policy credits_select on public.credits_ledger for select
  using (user_id = auth.uid() or public.is_super_admin());

create function public.credit_balance_of(p_user uuid, p_kind text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from public.credits_ledger
   where user_id = p_user and kind = p_kind;
$$;

create function public.credit_next_earned_at(p_user uuid, p_kind text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select min(earned_at) from public.credits_ledger
   where user_id = p_user and kind = p_kind and delta > 0;
$$;

create table public.store_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.store_settings enable row level security;
grant select on public.store_settings to anon, authenticated;
create policy store_settings_select on public.store_settings for select using (true);
`;

const TEACHER = "00000000-0000-4000-8000-0000000000a1";
const OTHER_TEACHER = "00000000-0000-4000-8000-0000000000a2";
const ADMIN = "00000000-0000-4000-8000-0000000000a3";
const TEAM = "00000000-0000-4000-8000-0000000000b1";
const TEAM2 = "00000000-0000-4000-8000-0000000000b2";
const GUEST = "00000000-0000-4000-8000-0000000000b3";

let db: PGlite;

async function rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

async function as<T>(user: string | null | "service", fn: () => Promise<T>): Promise<T> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user && user !== "service" ? user : ""]);
  await db.exec(user === "service" ? "set role service_role" : user ? "set role authenticated" : "set role anon");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

/** The error message of a failing statement, or null when it succeeded. */
async function fails(sql: string, params: unknown[] = []): Promise<string | null> {
  try {
    await db.query(sql, params);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

async function createClass(user: string, name = "Grade 8 robotics", school = "Al Khor School") {
  return as(user, async () => {
    // `select * from f(...)` calls the function once; `select (f(...)).*` would
    // call it once per column and create several classes.
    const [row] = await rows<{ id: string; join_code: string }>(
      "select * from public.create_school_class($1, $2)",
      [name, school],
    );
    return row;
  });
}

async function join(user: string, code: string, teamName = "Team Falcon") {
  return as(user, async () => {
    const [row] = await rows<{ join_class_team: { project_id: string; class_id: string; team_name: string } }>(
      "select public.join_class_team($1, $2)",
      [code, teamName],
    );
    return row.join_class_team;
  });
}

describe("0096_school_classes", () => {
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(SUPABASE_STUB);

    await db.exec(`
      insert into auth.users (id, email, email_confirmed_at, is_anonymous) values
        ('${TEACHER}', 'teacher@school.qa', now(), false),
        ('${OTHER_TEACHER}', 'other@school.qa', now(), false),
        ('${ADMIN}', 'admin@gestaltung360.com', now(), false),
        ('${TEAM}', null, null, true),
        ('${TEAM2}', null, null, true),
        ('${GUEST}', null, null, true);
      insert into public.profiles (id, role) values
        ('${TEACHER}', 'client'), ('${OTHER_TEACHER}', 'client'),
        ('${ADMIN}', 'super_admin'), ('${TEAM}', 'client'),
        ('${TEAM2}', 'client'), ('${GUEST}', 'client');
    `);

    // Twice: the migration must be safe to re-run.
    for (let i = 0; i < 2; i++) await db.exec(migration("0096_school_classes.sql"));
  }, 60_000);

  // create_school_class() allows 20 open classes per teacher; park the ones a
  // finished test left behind so the suite does not hit that guard.
  afterEach(async () => {
    await db.exec("update public.school_classes set archived = true where not archived");
  });

  afterAll(async () => {
    await db?.close();
  });

  it("seeds school_pricing with the owner's numbers", async () => {
    const [row] = await rows<{ value: Record<string, unknown> }>(
      "select value from public.store_settings where key = 'school_pricing'",
    );
    expect(row.value).toEqual({
      team_pack: { credits: 3, qar: 49 },
      class_pack: { credits: 15, qar: 199 },
      print: { base_qar: 30, per_gram_qar: 0.7 },
      free_delivery_class_order: true,
    });
  });

  describe("create_school_class", () => {
    it("gives a confirmed teacher a 6-character code with no vowels or look-alikes", async () => {
      const cls = await createClass(TEACHER);
      expect(cls.join_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ2-9]{6}$/);
      expect(cls.join_code).not.toMatch(/[AEIOU01]/);
    });

    it("gives every class its own code", async () => {
      const a = await createClass(TEACHER, "Class A");
      const b = await createClass(TEACHER, "Class B");
      expect(a.join_code).not.toBe(b.join_code);
    });

    it("refuses an anonymous (student) session and a blank name", async () => {
      await as(TEAM, async () => {
        expect(await fails("select public.create_school_class($1, $2)", ["X", "Y"])).toMatch(/sign_in/);
      });
      await as(TEACHER, async () => {
        expect(await fails("select public.create_school_class($1, $2)", ["  ", "Y"])).toMatch(/bad_name/);
        expect(await fails("select public.create_school_class($1, $2)", ["X", " "])).toMatch(/bad_school/);
      });
    });
  });

  describe("join_class_team", () => {
    it("creates a project owned by the team's own session and links it to the class", async () => {
      const cls = await createClass(TEACHER, "Joiners");
      const team = await join(TEAM, cls.join_code, "Team Falcon");

      const [project] = await rows<{ user_id: string; name: string; spec: Record<string, unknown> }>(
        "select user_id, name, spec from public.projects where id = $1",
        [team.project_id],
      );
      expect(project.user_id).toBe(TEAM);
      expect(project.name).toBe("Team Falcon");
      // The Studio routes refuse without consent; joining IS the consent step.
      expect(project.spec).toHaveProperty("aiConsent");

      const [link] = await rows<{ class_id: string; team_name: string }>(
        "select class_id, team_name from public.class_teams where project_id = $1",
        [team.project_id],
      );
      expect(link.class_id).toBe(cls.id);
      expect(link.team_name).toBe("Team Falcon");
    });

    it("accepts a lower-case code with spaces, and refuses an unknown or archived one", async () => {
      const cls = await createClass(TEACHER, "Case test");
      const team = await join(TEAM2, `  ${cls.join_code.toLowerCase()} `, "Team Oryx");
      expect(team.class_id).toBe(cls.id);

      await as(TEAM, async () => {
        expect(await fails("select public.join_class_team($1, $2)", ["ZZZZZZ", "T"])).toMatch(/bad_code/);
      });
      await db.query("update public.school_classes set archived = true where id = $1", [cls.id]);
      await as(TEAM, async () => {
        expect(await fails("select public.join_class_team($1, $2)", [cls.join_code, "T"])).toMatch(/bad_code/);
      });
    });

    it("refuses a blank or over-long team name", async () => {
      const cls = await createClass(TEACHER, "Names");
      await as(TEAM, async () => {
        expect(await fails("select public.join_class_team($1, $2)", [cls.join_code, "   "])).toMatch(/bad_team_name/);
        expect(await fails("select public.join_class_team($1, $2)", [cls.join_code, "x".repeat(41)])).toMatch(
          /bad_team_name/,
        );
      });
    });
  });

  describe("RLS", () => {
    it("shows a class to its teacher and the admin, and to nobody else", async () => {
      const cls = await createClass(TEACHER, "Private class");
      const mine = await as(TEACHER, () => rows("select id from public.school_classes where id = $1", [cls.id]));
      expect(mine).toHaveLength(1);
      for (const who of [OTHER_TEACHER, TEAM] as const) {
        const seen = await as(who, () => rows("select id from public.school_classes where id = $1", [cls.id]));
        expect(seen, `visible to ${who}`).toHaveLength(0);
      }
      // A visitor with no session cannot even read the table.
      await as(null, async () => {
        expect(await fails("select id from public.school_classes")).toMatch(/permission denied/i);
      });
      const asAdmin = await as(ADMIN, () => rows("select id from public.school_classes where id = $1", [cls.id]));
      expect(asAdmin).toHaveLength(1);
    });

    it("lets the teacher read their teams' projects read-only, and no other teacher's", async () => {
      const cls = await createClass(TEACHER, "Readable");
      const team = await join(TEAM, cls.join_code, "Team Pearl");

      const seen = await as(TEACHER, () =>
        rows<{ name: string }>("select name from public.projects where id = $1", [team.project_id]),
      );
      expect(seen).toHaveLength(1);
      expect(seen[0].name).toBe("Team Pearl");

      const other = await as(OTHER_TEACHER, () =>
        rows("select id from public.projects where id = $1", [team.project_id]),
      );
      expect(other).toHaveLength(0);

      // Read-only: there is no update policy for the class teacher.
      await as(TEACHER, async () => {
        const changed = await rows("update public.projects set name = 'hacked' where id = $1 returning id", [
          team.project_id,
        ]);
        expect(changed).toHaveLength(0);
      });
    });

    it("lets a team read its own link row but not the class, and lets no one forge a team", async () => {
      const cls = await createClass(TEACHER, "Team view");
      const team = await join(TEAM, cls.join_code, "Team Dhow");

      const link = await as(TEAM, () => rows("select id from public.class_teams where project_id = $1", [
        team.project_id,
      ]));
      expect(link).toHaveLength(1);
      const klass = await as(TEAM, () => rows("select id from public.school_classes where id = $1", [cls.id]));
      expect(klass).toHaveLength(0);

      // Only join_class_team() (SECURITY DEFINER) may create a team row.
      const [p] = await as(TEAM2, () =>
        rows<{ id: string }>("insert into public.projects (user_id, name) values ($1, 'mine') returning id", [TEAM2]),
      );
      await as(TEAM2, async () => {
        const msg = await fails(
          "insert into public.class_teams (class_id, project_id, team_name) values ($1, $2, 'X')",
          [cls.id, p.id],
        );
        expect(msg).toMatch(/row-level security/i);
      });
    });

    it("lets the teacher comment and the team read it, and nobody else write", async () => {
      const cls = await createClass(TEACHER, "Comments");
      const team = await join(TEAM, cls.join_code, "Team Majlis");
      const [link] = await rows<{ id: string }>("select id from public.class_teams where project_id = $1", [
        team.project_id,
      ]);

      await as(TEACHER, async () => {
        const made = await rows(
          "insert into public.class_team_comments (team_id, author_id, body) values ($1, $2, $3) returning id",
          [link.id, TEACHER, "Check the resistor on the LED."],
        );
        expect(made).toHaveLength(1);
      });

      const read = await as(TEAM, () =>
        rows<{ body: string }>("select body from public.class_team_comments where team_id = $1", [link.id]),
      );
      expect(read[0].body).toBe("Check the resistor on the LED.");

      const otherSees = await as(OTHER_TEACHER, () =>
        rows("select id from public.class_team_comments where team_id = $1", [link.id]),
      );
      expect(otherSees).toHaveLength(0);

      // A team cannot write a comment, even as itself.
      await as(TEAM, async () => {
        const msg = await fails(
          "insert into public.class_team_comments (team_id, author_id, body) values ($1, $2, 'hi')",
          [link.id, TEAM],
        );
        expect(msg).toMatch(/row-level security/i);
      });
    });
  });

  describe("credits come from the teacher", () => {
    it("lets an anonymous team spend the teacher's credit and writes the row against the teacher", async () => {
      const cls = await createClass(TEACHER, "Paying class");
      const team = await join(TEAM, cls.join_code, "Team Sail");

      // No credits yet: the team is told there are none, NOT to sign in.
      const [none] = await as(TEAM, () =>
        rows<{ credit_can_use: { allowed: boolean; reason: string | null; role: string } }>(
          "select public.credit_can_use('wiring', $1)",
          [team.project_id],
        ),
      );
      expect(none.credit_can_use.allowed).toBe(false);
      expect(none.credit_can_use.reason).toBe("no_credits");
      expect(none.credit_can_use.role).toBe("user"); // the teacher's role, not the student's

      await db.query(
        "insert into public.credits_ledger (user_id, kind, delta, reason, earned_at) values ($1, 'wiring', 2, 'admin_grant', now())",
        [TEACHER],
      );

      const [ok] = await as(TEAM, () =>
        rows<{ credit_can_use: { allowed: boolean; cost: string; balance: number } }>(
          "select public.credit_can_use('wiring', $1)",
          [team.project_id],
        ),
      );
      expect(ok.credit_can_use.allowed).toBe(true);
      expect(ok.credit_can_use.cost).toBe("credit");
      expect(ok.credit_can_use.balance).toBe(2);

      const [spent] = await as(TEAM, () =>
        rows<{ spend_credit: { charged: boolean; balance: number } }>("select public.spend_credit('wiring', $1)", [
          team.project_id,
        ]),
      );
      expect(spent.spend_credit.charged).toBe(true);
      expect(spent.spend_credit.balance).toBe(1);

      const ledger = await rows<{ user_id: string; delta: number; created_by: string }>(
        "select user_id, delta, created_by from public.credits_ledger where reason = $1",
        [`spend:${team.project_id}`],
      );
      expect(ledger).toHaveLength(1);
      expect(ledger[0].user_id).toBe(TEACHER); // the teacher pays
      expect(ledger[0].created_by).toBe(TEAM); // the team did it
      expect(await rows("select 1 from public.credits_ledger where user_id = $1", [TEAM])).toHaveLength(0);
    });

    it("still refuses a guest's own project", async () => {
      const [p] = await as(GUEST, () =>
        rows<{ id: string }>("insert into public.projects (user_id, name) values ($1, 'solo') returning id", [GUEST]),
      );
      const [r] = await as(GUEST, () =>
        rows<{ credit_can_use: { allowed: boolean; reason: string } }>("select public.credit_can_use('wiring', $1)", [
          p.id,
        ]),
      );
      expect(r.credit_can_use.allowed).toBe(false);
      expect(r.credit_can_use.reason).toBe("sign_in");
    });

    it("gives a cad credit three versions, shared with the class teacher's balance", async () => {
      const cls = await createClass(TEACHER, "CAD class");
      const team = await join(TEAM2, cls.join_code, "Team Dune");
      await db.query(
        "insert into public.credits_ledger (user_id, kind, delta, reason, earned_at) values ($1, 'cad', 1, 'admin_grant', now())",
        [TEACHER],
      );

      const first = await as(TEAM2, () =>
        rows<{ spend_credit: { charged: boolean; cost: string } }>("select public.spend_credit('cad', $1)", [
          team.project_id,
        ]),
      );
      expect(first[0].spend_credit.charged).toBe(true);

      // Two more versions are included (cad_regens_remaining = 2).
      for (const left of [1, 0]) {
        const [again] = await as(TEAM2, () =>
          rows<{ spend_credit: { charged: boolean; cost: string; regens: number } }>(
            "select public.spend_credit('cad', $1)",
            [team.project_id],
          ),
        );
        expect(again.spend_credit.charged).toBe(false);
        expect(again.spend_credit.cost).toBe("included");
        expect(again.spend_credit.regens).toBe(left);
      }
    });
  });

  describe("the 3-active-project cap", () => {
    it("still caps a person's own projects", async () => {
      const [u] = await rows<{ id: string }>(
        "insert into auth.users (id, email) values (gen_random_uuid(), 'capped@x.qa') returning id",
      );
      await db.query("insert into public.profiles (id, role) values ($1, 'client')", [u.id]);
      for (let i = 0; i < 3; i++) {
        await db.query("insert into public.projects (user_id, name) values ($1, $2)", [u.id, `P${i}`]);
      }
      expect(await fails("insert into public.projects (user_id, name) values ($1, 'P4')", [u.id])).toMatch(
        /project_limit/,
      );
    });

    it("does not count class team projects, so a capped team can still join", async () => {
      const cls = await createClass(TEACHER, "Capped teams");
      const [u] = await rows<{ id: string }>(
        "insert into auth.users (id, is_anonymous) values (gen_random_uuid(), true) returning id",
      );
      await db.query("insert into public.profiles (id, role) values ($1, 'client')", [u.id]);
      for (let i = 0; i < 3; i++) {
        await db.query("insert into public.projects (user_id, name) values ($1, $2)", [u.id, `Own${i}`]);
      }
      // Already at the cap, yet joining a class works…
      const team = await join(u.id, cls.join_code, "Team Late");
      expect(team.project_id).toBeTruthy();
      // …and a class project is itself exempt, so several are fine.
      const second = await createClass(TEACHER, "Second class");
      await join(u.id, second.join_code, "Team Later");
      const active = await rows<{ n: string }>(
        "select count(*) as n from public.projects where user_id = $1 and status = 'active'",
        [u.id],
      );
      expect(Number(active[0].n)).toBe(5);
    });
  });
});
