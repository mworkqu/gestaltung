// Videos & YouTube: the retire worker. SERVER ONLY. The logic is in
// youtube-retire-core.ts (shared with the Mac Mini worker); this wrapper
// purges the whole storefront when the site links changed, as before the split.
// Called by the daily cron (through lib/cron/jobs.ts) and by "Delete now" in
// the dashboard for one entry (onlyIds, grace period ignored).

import { revalidateStorefront } from "@/lib/cache/storefront";
import { runRetirementsWith, type RetireSummary } from "@/lib/integrations/youtube-retire-core";

export type { RetireStop, RetireSummary } from "@/lib/integrations/youtube-retire-core";

export function runRetirements(opts: { onlyIds?: string[]; now?: Date } = {}): Promise<RetireSummary> {
  return runRetirementsWith(opts, revalidateStorefront);
}
