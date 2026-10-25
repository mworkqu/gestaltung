# Stage 8B — Upload Funnel Monetization + B2B Path Bifurcation

Read CLAUDE.md for full project context. Stage 8A must be complete before starting this stage. Stack: Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, next-intl, Supabase. Jobs workflow (Stages 6a/6b/7) is complete — this stage extends the job creation form and DB schema only.

---

## Part 1: Database Migration — `0008_job_upsells.sql`

Create `supabase/migrations/0008_job_upsells.sql`:

```sql
-- Speed tier
ALTER TABLE jobs ADD COLUMN speed_tier TEXT NOT NULL DEFAULT 'standard'
  CONSTRAINT jobs_speed_tier_check CHECK (speed_tier IN ('standard','express'));

-- Post-processing options (array of strings)
ALTER TABLE jobs ADD COLUMN post_processing TEXT[] NOT NULL DEFAULT '{}';

-- Inspection report add-on
ALTER TABLE jobs ADD COLUMN inspection_report BOOLEAN NOT NULL DEFAULT FALSE;

-- Customer journey path
ALTER TABLE jobs ADD COLUMN job_path TEXT NOT NULL DEFAULT 'prototype'
  CONSTRAINT jobs_job_path_check CHECK (job_path IN ('prototype','production'));

-- Estimated quantity range for production path (nullable — only set when job_path = 'production')
ALTER TABLE jobs ADD COLUMN production_qty_range TEXT
  CONSTRAINT jobs_production_qty_range_check CHECK (
    production_qty_range IS NULL OR
    production_qty_range IN ('10-50','50-250','250-1000','1000+')
  );
```

No new RLS policies needed — existing jobs policies cover these columns. Existing `jobs_status_transition` trigger is unaffected.

**RUN this migration in Supabase SQL editor after 0007.**

---

## Part 2: Job Creation Form Upsells

File: `components/jobs/new-job-form.tsx` (the client form used in `app/[locale]/dashboard/jobs/new/`)

Add three upsell sections **after** the existing file upload and method fields, **before** the submit button.

### 2a — Path Selection (Prototyping vs Production)

A two-card toggle (radio, full-width):

| Card | Label | Sublabel |
|------|-------|----------|
| prototype | Prototyping & One-offs | Fast turnaround. 1–9 parts. |
| production | Low-Volume Production | Volume pricing. 10 to 10,000+ parts. |

When `production` is selected, reveal a `<select>` for `production_qty_range`:
- 10–50 parts
- 50–250 parts
- 250–1,000 parts
- 1,000+ parts

### 2b — Speed Tier

Two radio cards:

| Value | Label | Sublabel | Visual cue |
|-------|-------|----------|------------|
| standard | Standard | Workshop schedules your job normally | — |
| express | Express / Rush +35% | Moved to front of queue | amber badge |

Display the premium as an informational note, not a computed price (you don't have final pricing yet). Copy: "Express orders are prioritised across our workshop network. Final quote will reflect the rush premium."

### 2c — Add-Ons Checklist

Three checkbox rows:

| Field | Label | Sublabel |
|-------|-------|----------|
| post_processing includes 'bead_blast' | Bead Blasting | Matte, uniform surface finish |
| post_processing includes 'anodize' | Anodizing (aluminium parts) | Colour + corrosion resistance |
| post_processing includes 'inspection_report' (maps to `inspection_report` boolean) | Dimensional Inspection Report | Certified measurement report — required by many procurement departments |

Style: bordered checkbox cards, azure accent on checked state, consistent with existing form fields.

---

## Part 3: Server Action Updates

File: `app/[locale]/dashboard/jobs/actions.ts`

Update `createJob` to accept and persist the new fields:
- `speed_tier: 'standard' | 'express'`
- `post_processing: string[]`
- `inspection_report: boolean`
- `job_path: 'prototype' | 'production'`
- `production_qty_range: string | null`

Add Zod (or manual) validation:
- `production_qty_range` must be non-null when `job_path === 'production'`
- `speed_tier` must be one of the allowed values
- `post_processing` items must be in `['bead_blast', 'anodize']`

No service-role. Use server Supabase client as in existing actions.

---

## Part 4: Job Detail Page — Display Upsells

File: `app/[locale]/dashboard/jobs/[id]/page.tsx`

In the job detail view, add a "Job Specifications" card (visible to all roles who can view the job) that shows:

- Path: `Prototyping` or `Low-Volume Production` (+ qty range if set)
- Speed: `Standard` or `Express / Rush`
- Post-Processing: comma-separated list of selected options, or "None"
- Inspection Report: `Requested` or `—`

Use the existing detail card styling. Add these labels to `messages/{en,ar}.json` under a `JobSpecs` namespace.

---

## Part 5: Parts Store Fastener Bundle Prompt

This is a UI-only teaser — no e-commerce backend yet (that's Stage 9).

**Where:** On the job detail page (`app/[locale]/dashboard/jobs/[id]/page.tsx`), after the job-files section, add a dismissible banner (client component, dismissed state in `localStorage` per `job_id`):

> **Need fasteners for this assembly?**
> We stock standard metric screws, nuts, washers, and bolts — available for same-day pickup or bundled with your order delivery.
> [Browse Parts Store] [Dismiss]

"Browse Parts Store" links to `/parts` (a page created below). "Dismiss" hides the banner for that `job_id` only.

**New route:** `app/[locale]/parts/page.tsx` — a simple "coming soon" page with:
- Heading: "Mechanical Parts Store" / "متجر القطع الميكانيكية"
- Subtext: "Screws, nuts, washers, bolts, and precision fasteners — sourced locally, delivered fast across Qatar."
- A waitlist CTA that links to the WhatsApp number (`NEXT_PUBLIC_WHATSAPP_NUMBER`) with a pre-filled message: "I'm interested in the Gestaltung parts store."
- Add `Nav.partsStore` to header nav (after "CAD Assistance")

All copy in `messages/{en,ar}.json` under `PartsStore` namespace.

---

## Testing Checklist (verify before Stage 9)

- [ ] Migration 0008 runs without error in Supabase
- [ ] Job creation form shows path toggle, speed tier, and add-on checkboxes
- [ ] Selecting `production` reveals qty range select; validation blocks submit if omitted
- [ ] `createJob` persists all new fields; confirmed via Supabase table editor
- [ ] Job detail card shows the specifications section for client, workshop, and super_admin views
- [ ] Fastener bundle banner appears on job detail; dismiss hides it (persists on refresh); "Browse Parts Store" navigates to `/parts`
- [ ] `/en/parts` and `/ar/parts` render; WhatsApp link includes pre-filled message
- [ ] Header shows "Parts Store" nav link on both locales
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] Push to `main` → Vercel deploy succeeds
