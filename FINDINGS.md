# FINDINGS

Running log for the projects-centred rebuild. Things discovered along the way
that are deliberately **not** fixed in the step that found them, so they don't
get lost.

---

## Open — revisit at a named step

### 1. `/design` hub card points at `/design/quote`, not `/projects/new`
**Found:** Step B, commit 1.
The first card on the `/design` hub ("upload a file to manufacture") used to
point at `/design/upload`, which the jobs pipeline owned and which is now
deleted. It temporarily points at `/design/quote` — the surviving public lead
flow — because `/projects/new` does not exist yet.
**Revisit at step 7**, once `/projects/new` ships: decide whether the card goes
to the project flow, stays on the quote flow, or the hub collapses to a single
path. Same decision applies to the six legacy redirects in `next.config.mjs`
that now all resolve to `/design/quote`.

### 2. Orphaned i18n keys
**Found:** Step B, commit 1.
The `Jobs` (134 keys), `JobSpecs` (14) and `PartsStore` (11) namespaces are now
unused in both `messages/en.json` and `messages/ar.json`, as are
`Inventory.projectsNav`, `Inventory.itemsNav` and the job-related keys in the
`Admin` namespace (`jobs`, `openJobs`, `viewAllJobs`, `statusTitle`,
`recentTitle`, `recentEmpty`). They were deliberately left in place: removing
~318 keys while the surrounding code is still moving is how en/ar drift starts,
and the files are currently at exact parity (762/762).
**Revisit at step 16 (i18n sweep)** — remove orphans, re-verify parity.

### 3. `handle_new_user` leaves every profile tenant-less
**Found:** Phase 1 audit.
`public.handle_new_user()` inserts a `profiles` row with `role='client'` and
**no `tenant_id`**, and nothing anywhere in the codebase ever inserts a
`tenants` row. Consequences today:
- `current_user_tenant_id()` returns NULL for every self-signed-up user.
- Tenant-scoped RLS (`tenant_id = current_user_tenant_id()`) therefore matches
  zero rows — reads silently return empty rather than failing.
- `inventory_items.tenant_id` is `NOT NULL` and its default-tenant trigger fills
  it from that NULL, so an insert raises a not-null violation.

With the jobs pipeline gone this may stop mattering entirely: the new
`projects` / `cart_items` / `client_inventory_items` tables all key on
`user_id`, not `tenant_id`. Recorded so it isn't rediscovered as a mystery.
**No action planned** — revisit only if tenant-scoped features return.

### 4. `inventory_items` is orphaned by purpose, not by code
**Found:** Step A dependency report.
Its standalone CRUD area at `app/[locale]/inventory/` survives untouched, but
the only workflow that actually moved those numbers — BOM stock deduction on
`startJob` — died with the jobs pipeline. What's left is manual CRUD for the
`workshop` role, which is now dormant, and it is unusable by clients for the
reason in note 3. The table is being kept (it may hold real data, and it costs
nothing to leave) and is explicitly **not** being built on: step 12 adds a
separate `client_inventory_items` table.
**Revisit after step 12**, once the client inventory exists and the two are
provably distinct in the UI and in the en/ar labels.

### 5. CLAUDE.md's "PENDING MIGRATIONS" list is stale
**Found:** Step B, commit 2.
CLAUDE.md lists 0010, 0011 and 0012 as not yet run. A row-count sweep on
2026-09-18 shows all twelve migrations had in fact been applied: `parts` holds
121 rows (0011), `job_variations` existed (0008), the `quote-uploads` bucket
holds a file (0012), and the exported `jobs` rows carry `speed_tier` /
`job_path` (0010).
**Action:** update the CLAUDE.md status table during the next step that touches
it, and add 0013 as applied once it is run.

---

## Resolved

_(nothing yet)_
