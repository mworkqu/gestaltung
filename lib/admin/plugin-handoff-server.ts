import "server-only";

import { readPluginHandoff, type PluginHandoffInfo } from "@/lib/admin/plugin-handoff";
import { isMissingRelation } from "@/lib/supabase/errors";

// Untyped on purpose: plugin_handoffs (migration 0112) may not be in the
// generated Database types yet, and the table may not exist in production.
type Loose = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
};

export type LeadHandoff = { info: PluginHandoffInfo | null; migrationMissing: boolean };

/** The handoff behind a plugin lead; `migrationMissing` when 0112 has not run. */
export async function loadLeadHandoff(supabase: unknown, inquiryId: string): Promise<LeadHandoff> {
  try {
    const { data, error } = await (supabase as Loose).from("plugin_handoffs").select("*").eq("inquiry_id", inquiryId).maybeSingle();
    if (error) return { info: null, migrationMissing: isMissingRelation(error) };
    return { info: data ? readPluginHandoff(data) : null, migrationMissing: false };
  } catch {
    return { info: null, migrationMissing: false };
  }
}
