"use server";

// TEST-ONLY (lib/e2e-fixtures.ts): no-write stand-ins for the admin quote
// actions, so the e2e suite can press Save on the fixture page. They validate
// exactly like the real ones and write nothing anywhere.

import { e2eFixturesEnabled } from "@/lib/e2e-fixtures";
import { parseFinalQuote, validateQuoteRule } from "@/lib/studio/request-summary";
import type { SaveQuoteResult, SaveRuleResult } from "@/app/[locale]/dashboard/leads/actions";

export async function fixtureSaveQuote(input: { id: string; locale: string; finalQar: string; note: string }): Promise<SaveQuoteResult> {
  if (!e2eFixturesEnabled()) return { ok: false, error: "forbidden" };
  const finalQar = parseFinalQuote(input.finalQar);
  if (finalQar === null) return { ok: false, error: "invalid" };
  if (String(input.note ?? "").trim().length > 1000) return { ok: false, error: "note_too_long" };
  return { ok: true, finalQar };
}

export async function fixtureSaveRule(input: { locale: string; base_qar: string; per_gram_qar: string; spread: string }): Promise<SaveRuleResult> {
  if (!e2eFixturesEnabled()) return { ok: false, error: "forbidden" };
  const checked = validateQuoteRule({ base_qar: input.base_qar, per_gram_qar: input.per_gram_qar, spread: input.spread });
  return checked.ok ? { ok: true, rule: checked.rule } : { ok: false, error: "invalid", bad: checked.bad };
}
