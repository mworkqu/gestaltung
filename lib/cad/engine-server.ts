// Server-side reads for the CAD engine switch and the board the model must
// hold. store_settings.cad_engine goes through the same cookie-free anon
// client + unstable_cache + "store-settings" tag as the other settings reads
// (lib/site-v2-server.ts); no row or any error = browser.

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { SETTINGS_TAG, STOREFRONT_REVALIDATE } from "@/lib/cache/storefront";
import { createPublicClient } from "@/lib/supabase/public";
import { projectBoards, type Footprint } from "@/lib/prototyping/footprints";
import type { ProjectBom } from "@/lib/prototyping/bom";
import { CAD_ENGINE_KEY, DEFAULT_CAD_ENGINE, parseCadEngineSetting, type CadEngineSetting } from "./engine";

export const getCadEngineSetting = unstable_cache(
  async (): Promise<CadEngineSetting> => {
    try {
      const supabase = createPublicClient();
      if (!supabase) return DEFAULT_CAD_ENGINE;
      const { data, error } = await supabase.from("store_settings").select("value").eq("key", CAD_ENGINE_KEY).maybeSingle();
      if (error || !data) return DEFAULT_CAD_ENGINE;
      return parseCadEngineSetting(data.value);
    } catch {
      return DEFAULT_CAD_ENGINE;
    }
  },
  ["cad-engine"],
  { tags: [SETTINGS_TAG], revalidate: STOREFRONT_REVALIDATE }
);

/**
 * The known boards of a project, read with the caller's RLS client the same
 * way components/prototyping/use-project-boards.ts does (BOM electronics
 * lines, catalog parts, store lines). A failed read = no board known, which
 * only drops the fit check (never blocks a model).
 */
export async function loadProjectBoards(supabase: SupabaseClient, projectId: string): Promise<Footprint[]> {
  try {
    const [project, parts, items] = await Promise.all([
      supabase.from("projects").select("bom").eq("id", projectId).maybeSingle(),
      supabase.from("project_parts").select("name").eq("project_id", projectId),
      supabase.from("project_items").select("part:parts(name)").eq("project_id", projectId),
    ]);
    const bom = (project.data as { bom?: ProjectBom | null } | null)?.bom ?? null;
    const itemNames = ((items.data ?? []) as { part: { name: string } | { name: string }[] | null }[]).flatMap((i) =>
      Array.isArray(i.part) ? i.part.map((x) => x.name) : i.part ? [i.part.name] : []
    );
    return projectBoards({
      bom,
      partNames: ((parts.data ?? []) as { name: string }[]).map((p) => p.name),
      itemNames,
    });
  } catch {
    return [];
  }
}
