-- ============================================================================
-- Gestaltung — Stage 8b: upload-funnel upsells + B2B path bifurcation
-- ============================================================================
-- Run AFTER 0009_security_hardening.sql. (The Stage 8b prompt named this file
-- 0008, but 0008/0009 were already taken — only the number moved.)
-- Adds per-job upsell columns to public.jobs. No new RLS needed: the existing
-- jobs policies cover whole rows, and the 0009 jobs_status_transition trigger
-- already gates WHO may edit and WHEN — these columns ride along.
-- ============================================================================

-- Speed tier: standard | express (rush, +35% premium applied at quoting time).
alter table public.jobs add column if not exists speed_tier text not null default 'standard';
alter table public.jobs drop constraint if exists jobs_speed_tier_check;
alter table public.jobs add constraint jobs_speed_tier_check
  check (speed_tier in ('standard', 'express'));

-- Post-processing options, e.g. {bead_blast, anodize}.
alter table public.jobs add column if not exists post_processing text[] not null default '{}';

-- Dimensional inspection report add-on.
alter table public.jobs add column if not exists inspection_report boolean not null default false;

-- Customer journey path: one-off prototyping vs low-volume production.
alter table public.jobs add column if not exists job_path text not null default 'prototype';
alter table public.jobs drop constraint if exists jobs_job_path_check;
alter table public.jobs add constraint jobs_job_path_check
  check (job_path in ('prototype', 'production'));

-- Estimated quantity range — only meaningful (and required by the app) when
-- job_path = 'production'.
alter table public.jobs add column if not exists production_qty_range text;
alter table public.jobs drop constraint if exists jobs_production_qty_range_check;
alter table public.jobs add constraint jobs_production_qty_range_check
  check (
    production_qty_range is null
    or production_qty_range in ('10-50', '50-250', '250-1000', '1000+')
  );
