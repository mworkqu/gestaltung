"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getSessionContext } from "@/lib/auth/get-session";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { isMissingQuoteColumn } from "@/lib/studio/server/quote";
import { parseFinalQuote, QUOTE_RULE_KEY, validateQuoteRule, type QuoteRule } from "@/lib/studio/request-summary";
import type { InquiryStatus } from "@/lib/supabase/types";

const STATUSES: InquiryStatus[] = ["new", "contacted", "closed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The locale comes from a hidden form field (attacker-controllable). Pin it to a
// known locale so it can never steer revalidatePath at a crafted path.
function safeLocale(formData: FormData): "en" | "ar" {
  return String(formData.get("locale")) === "ar" ? "ar" : "en";
}

// Move a lead through new -> contacted -> closed. RLS already limits updates to
// super_admin; the role check here fails fast rather than leaning on the policy
// alone, and pinning the status keeps a crafted form field out of the write.
export async function setLeadStatus(formData: FormData) {
  const locale = safeLocale(formData);
  const id = String(formData.get("id") ?? "");
  const requested = String(formData.get("status") ?? "");
  const status = STATUSES.find((s) => s === requested);
  if (!id || !status) return;

  const session = await getSessionContext();
  if (!session || session.profile.role !== "super_admin") return;

  const supabase = await createClient();
  await supabase.from("inquiries").update({ status }).eq("id", id);

  revalidatePath(`/${locale}/dashboard/leads`);
  revalidatePath(`/${locale}/dashboard/leads/${id}`);
}

// ── W2b: the owner's quote on a Studio request ──────────────────────────────

export type SaveQuoteResult = { ok: true; finalQar: number } | { ok: false; error: "forbidden" | "invalid" | "note_too_long" | "run_0073" | "failed" };

/**
 * Save "Your quote (QAR)" + optional note on a lead. super_admin only (checked
 * here and by RLS). quoted_at / quoted_by are stamped by the 0073 trigger.
 * The client's request page then shows the quote instead of the range.
 */
export async function saveLeadQuote(input: { id: string; locale: string; finalQar: string; note: string }): Promise<SaveQuoteResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, error: "forbidden" };
  if (!UUID.test(input.id)) return { ok: false, error: "invalid" };
  const finalQar = parseFinalQuote(input.finalQar);
  if (finalQar === null) return { ok: false, error: "invalid" };
  const note = String(input.note ?? "").trim();
  if (note.length > 1000) return { ok: false, error: "note_too_long" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inquiries")
    .update({ final_quote_qar: finalQar, quote_note: note || null, quoted_at: new Date().toISOString(), quoted_by: session.profile.id })
    .eq("id", input.id)
    .select("id, project_id")
    .maybeSingle();
  if (error) return { ok: false, error: isMissingQuoteColumn(error) ? "run_0073" : "failed" };
  if (!data) return { ok: false, error: "failed" };

  const locale = input.locale === "ar" ? "ar" : "en";
  revalidatePath(`/${locale}/dashboard/leads`);
  revalidatePath(`/${locale}/dashboard/leads/${input.id}`);
  const projectId = (data as { project_id?: string | null }).project_id;
  if (projectId) for (const l of ["en", "ar"]) revalidatePath(`/${l}/projects/${projectId}/request`);
  return { ok: true, finalQar };
}

// ── W2b: the editable estimate rule (store_settings.studio_quote_rule) ──────

export type SaveRuleResult = { ok: true; rule: QuoteRule } | { ok: false; error: "forbidden" | "invalid" | "failed"; bad?: (keyof QuoteRule)[] };

export async function saveQuoteRule(input: { locale: string; base_qar: string; per_gram_qar: string; spread: string }): Promise<SaveRuleResult> {
  const session = await getSessionContext();
  if (session?.profile.role !== "super_admin") return { ok: false, error: "forbidden" };
  const checked = validateQuoteRule({ base_qar: input.base_qar, per_gram_qar: input.per_gram_qar, spread: input.spread });
  if (!checked.ok) return { ok: false, error: "invalid", bad: checked.bad };

  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: QUOTE_RULE_KEY, value: checked.rule, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "failed" };

  revalidateStorefront();
  const locale = input.locale === "ar" ? "ar" : "en";
  revalidatePath(`/${locale}/dashboard/leads`);
  return { ok: true, rule: checked.rule };
}
