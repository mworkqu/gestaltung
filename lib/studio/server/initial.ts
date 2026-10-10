// The Studio's first state, read on the server (P5-15e first render): the same
// rows the browser's liveStudioApi().load() reads, so the page arrives with the
// current step already rendered (no skeleton → content swap, no layout shift,
// no wait for supabase-js + /api/studio/doc). null = let the browser load it
// (no session, not the owner, a read error) — it then shows the usual
// sign-in / not-found / retry states.

import { createClient } from "@/lib/supabase/server";
import { hasAiConsent, type Spec } from "@/lib/prototyping/spec";
import type { LoadResult } from "@/lib/studio/client/api";
import { loadDoc } from "./doc";

export type StudioInitial = Extract<LoadResult, { ok: true }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadStudioInitial(projectId: string): Promise<StudioInitial | null> {
  if (!UUID.test(projectId)) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase.from("projects").select("id, name, brief, spec").eq("id", projectId).maybeSingle();
    if (error || !data) return null;
    const row = data as { name: string | null; brief: string | null; spec: Spec | null };
    const r = await loadDoc(supabase, projectId);
    if (!r.ok) return null;
    return {
      ok: true,
      project: {
        name: row.name ?? "",
        consented: hasAiConsent(row.spec),
        brief: typeof row.brief === "string" && row.brief.trim() ? row.brief : null,
      },
      doc: r.available ? r.doc : null,
      version: r.available ? r.version : 0,
      // Before 0068 the doc lives in memory only.
      persist: r.available,
    };
  } catch {
    return null;
  }
}
