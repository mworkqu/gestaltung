# Batch 1 runbook — `0103` then `0104` (pre-deploy)

> **Done — 0103 and 0104 were run on 2026-10-26 and verified; batch 2 followed after the
> deploy. Kept as the record of how it was done and checked.**

**You run these, not me.** Not a policy dodge — I have no way to execute DDL from here, and
the missing piece is a credential I should not go looking for:

| route | why it does not work |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | it is a PostgREST JWT. PostgREST exposes tables and RPCs; it has no arbitrary-SQL endpoint, so it cannot run DDL |
| `psql` | not installed on this machine |
| `supabase db push` | the CLI is available, but the project is not linked here and there is no database password or `DATABASE_URL` in `.env.local` |

So below is a paste-ready runbook. Afterwards I verify independently — including one check
that does not depend on you reading your own query output back to me.

---

## Which copy to paste — this matters

There are TWO copies of these files on your machine. Use the repo ones:

```
PASTE THIS   <repo>/supabase/migrations/0103_guards_and_grants.sql
NOT THIS     <repo>/review/gestaltung-audit-reports-2026-10/proposed-migrations/0103_guards_and_grants.sql
```

The `review/…/proposed-migrations/` folder is the audit's original proposal from
2026-10-23. The branch re-reviewed it, so three of the six files now differ in content
(ignoring line endings): **0100 by 66 lines, 0103 by 21, 0105 by 11**. 0101, 0102 and 0104
are identical either way.

For batch 1 the difference is not cosmetic. The audit's 0103 caps every order at **100
line items**; the repo's raises that to **300** and exempts class orders from the line cap
entirely, because a teacher orders for a whole class in one go. Paste the audit's copy and
you would quietly cap school orders at 100 lines.

The repo copy is also the one this plan was analysed against, and the only one in PR #4 —
`review/` is git-ignored, so those originals are not in the pull request at all.

## Step 1 — `0103_guards_and_grants.sql`

Supabase → SQL editor → paste the **whole file** → Run.

Prerequisites are already satisfied (0097 ✓, 0098 ✓, probed 2026-10-26).

**Verify — expect `4`:**

```sql
select count(*) from pg_trigger
where tgname in ('part_order_items_limits','part_orders_rate_limit',
                 'projects_guard_admin_columns','inquiries_guard_insert');
```

**Verify the grant moved — expect `anon` false, `authenticated` true:**

```sql
select has_function_privilege('anon','public.offer_landed_cost_qar(uuid)','execute') as anon_can,
       has_function_privilege('authenticated','public.offer_landed_cost_qar(uuid)','execute') as auth_can;
```

`authenticated` keeping EXECUTE is intentional: the admin check moved inside the function,
so the dashboard keeps working while the raw cost stops being public.

## Step 2 — `0104_quote_upload_path.sql`

Same again, whole file.

**Verify — the policy must now carry the path regex:**

```sql
select policyname, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname = 'quote_uploads_insert';
```

Expect `with_check` to contain `^[0-9a-f]{8}-...` and `bucket_id = 'quote-uploads'`.

## Step 3 — one smoke test each

* **0103:** open Dashboard → Store → any product → the sourcing panel still shows a landed
  cost. (If it shows nothing, tell me before going further — that is the one regression
  this file could cause.)
* **0104:** open `/en/design/quote` as a guest and send a request with a small file. It
  must still upload. The live app already writes `<uuid>/<sanitised-name>`, which is what
  the new rule allows, so this should be unchanged.

---

## What I check afterwards

Tell me when both are in and I will re-probe, read-only, with the public key:

1. **`offer_landed_cost_qar` must stop answering `anon`.** Measured **before** batch 1 on
   2026-10-26: `HTTP 200`, returns `null` — i.e. any visitor can call it today. After 0103
   it must answer `42501 permission denied`. This is the one I can prove myself.
2. The schema probes from PR_AND_DEPLOY.md step 2 re-run, to confirm nothing else moved.

`0104` I cannot verify from outside without attempting an upload, and I am not going to
write to your storage to test a policy. Its check is the `pg_policies` query above.

---

## Then, and only then

Merge PR #4 → deploy → **batch 2**: `0100`, `0101`, `0102`, `0105`, and optionally `0106`.

`0102` is the one that must not jump the queue: it revokes `spend_credit` from
`authenticated`, and the code in production today calls it on the user's own client, so
running it before the deploy stops every wiring diagram and 3D model.
