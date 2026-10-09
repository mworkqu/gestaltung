-- ============================================================================
-- Gestaltung — 0051: plans and service prices as data (P1-06 / P1-07, 2026-10-09)
-- ============================================================================
-- Run AFTER 0050. Safe to re-run.
--
-- Seeds two store_settings keys read by the public /pricing page (and /design,
-- /design/drawing) through the cached, cookie-free settings read
-- (lib/store/public-catalog.ts getPricingPlans / getServicePrices, tag
-- "store-settings"). Until this runs, the site shows the identical defaults
-- from lib/pricing/defaults.ts (lib/pricing/plans.test.ts checks they match).
--
-- `on conflict (key) do nothing`: once the owner edits a value, re-running this
-- file never puts the defaults back. Plans are DISPLAY-ONLY until card payments
-- exist (Phase 4): nothing here bills anyone. All numbers are DEFAULTS — owner
-- to confirm. After a manual edit of either row, press any Dashboard → Store
-- save (revalidateStorefront) or wait 5 minutes.
-- ============================================================================

insert into public.store_settings (key, value, updated_at)
values ('pricing_plans', '{"currency":"QAR","overage_per_credit_qar":20,"refund_window_days":30,"plans":[{"id":"maker","price_qar_month":0,"active_projects":3,"wiring_per_month":0,"cad_per_month":0,"first_circuit_free":true,"bom":true,"human":"whatsapp","kit_discount_pct":0},{"id":"builder","price_qar_month":149,"active_projects":10,"wiring_per_month":5,"cad_per_month":2,"first_circuit_free":true,"bom":true,"human":"priority_quotes","kit_discount_pct":5,"target":true},{"id":"studio","price_qar_month":399,"active_projects":null,"wiring_per_month":15,"cad_per_month":6,"first_circuit_free":true,"bom":true,"human":"engineer_hour","kit_discount_pct":10,"anchor":true},{"id":"institutions","contact":true}]}'::jsonb, now())
on conflict (key) do nothing;

insert into public.store_settings (key, value, updated_at)
values ('service_prices', '{"currency":"QAR","enclosure_from":800,"drawing_simple":200,"drawing_assembly":450,"drawing_complex_from":800,"sprint_from":20000,"pilot_from":15000}'::jsonb, now())
on conflict (key) do nothing;

do $$ begin raise notice '0051 applied: pricing_plans + service_prices seeded (existing values kept)'; end $$;
