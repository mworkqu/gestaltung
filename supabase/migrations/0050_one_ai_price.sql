-- ============================================================================
-- Gestaltung — 0050: one AI price (P0-05, 2026-10-08)
-- ============================================================================
-- Run AFTER 0049. Safe to re-run.
--
-- store_settings.ai_pricing.per_call_qar was 1 (0038) while the real price of
-- one AI call is one credit = QAR 20 (0042, CREDIT_QAR in lib/credits/constants.ts).
-- The per-call figure must always equal the credit price (QAR 20). Charging
-- stays OFF: nothing is billed yet, the figure is only shown.
-- ============================================================================

insert into public.store_settings (key, value, updated_at)
values ('ai_pricing', '{"per_call_qar": 20, "charging": false}'::jsonb, now())
on conflict (key) do update
  set value = '{"per_call_qar": 20, "charging": false}'::jsonb,
      updated_at = now();

do $$ begin raise notice '0050 applied: ai_pricing = QAR 20 per call, charging off'; end $$;
