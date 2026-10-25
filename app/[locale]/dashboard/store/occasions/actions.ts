"use server";

import { revalidatePath } from "next/cache";

import { getSessionContextCached } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { revalidateStorefront } from "@/lib/cache/storefront";
import { draftsToInput, OCCASIONS_KEY, validateOccasions, type OccasionDraft, type OccasionError } from "@/lib/occasions";
import { asLocale } from "@/lib/locale";

// Seasonal campaigns (P3-07): store_settings.occasions. super_admin only —
// checked here and again by RLS (store_settings_write). The rows are validated
// with the same schema the public read uses (lib/occasions.ts), so a saved
// list is always one the storefront shows in full.
export type SaveOccasionsResult =
  | { ok: true; count: number }
  | { ok: false; errors: OccasionError[]; message?: string };

export async function saveOccasions(locale: string, drafts: OccasionDraft[]): Promise<SaveOccasionsResult> {
  const session = await getSessionContextCached();
  if (session?.profile.role !== "super_admin") return { ok: false, errors: [], message: "forbidden" };

  const checked = validateOccasions(draftsToInput(Array.isArray(drafts) ? drafts : []));
  if (!checked.ok) return { ok: false, errors: checked.errors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("store_settings")
    .upsert({ key: OCCASIONS_KEY, value: checked.value, updated_at: new Date().toISOString() });
  if (error) return { ok: false, errors: [], message: error.message };

  revalidateStorefront();
  const safeLocale = asLocale(locale);
  revalidatePath(`/${safeLocale}/dashboard/store/occasions`);
  return { ok: true, count: checked.value.length };
}
