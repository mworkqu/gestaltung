// Landing reference data loader — SERVER ONLY. Reads cc_skill_areas and
// cc_competition_modules with the cookie-free anon client (both tables are
// anon-readable, 0077) and caches for an hour. Any failure (env missing,
// migration not run, network) falls back to the seed copy in ./seed.ts, so
// the landing page never breaks.

import { unstable_cache } from "next/cache";

import { createPublicClient } from "@/lib/supabase/public";

import {
  FALLBACK_MODULES,
  FALLBACK_SKILL_AREAS,
  normaliseModules,
  normaliseSkillAreas,
  type LandingModule,
  type LandingSkillArea,
} from "./seed";

if (typeof window !== "undefined") throw new Error("lib/cad-champions/landing/data.ts is server-only");

export type LandingData = {
  skillAreas: readonly LandingSkillArea[];
  modules: readonly LandingModule[];
};

async function readLandingData(): Promise<LandingData> {
  const supabase = createPublicClient();
  if (!supabase) return { skillAreas: FALLBACK_SKILL_AREAS, modules: FALLBACK_MODULES };
  try {
    const [areas, modules] = await Promise.all([
      supabase
        .from("cc_skill_areas")
        .select("id, slug, name_en, name_ar, weight_percent, description_en, description_ar")
        .order("id"),
      supabase
        .from("cc_competition_modules")
        .select("code, position, name_en, name_ar, hours, summary_en, summary_ar, is_active")
        .order("position"),
    ]);
    if (areas.error) console.error("[cc-landing] skill areas read failed:", areas.error.code ?? areas.error.message);
    if (modules.error) console.error("[cc-landing] modules read failed:", modules.error.code ?? modules.error.message);
    return {
      skillAreas: areas.error ? FALLBACK_SKILL_AREAS : normaliseSkillAreas(areas.data),
      modules: modules.error ? FALLBACK_MODULES : normaliseModules(modules.data),
    };
  } catch (e) {
    console.error("[cc-landing] reference data read failed:", e instanceof Error ? e.message : "unknown");
    return { skillAreas: FALLBACK_SKILL_AREAS, modules: FALLBACK_MODULES };
  }
}

const cached = unstable_cache(readLandingData, ["cc-landing-reference-v1"], {
  revalidate: 3600,
  tags: ["cc-reference"],
});

export async function getLandingData(): Promise<LandingData> {
  try {
    return await cached();
  } catch (e) {
    console.error("[cc-landing] cache failed:", e instanceof Error ? e.message : "unknown");
    return { skillAreas: FALLBACK_SKILL_AREAS, modules: FALLBACK_MODULES };
  }
}
