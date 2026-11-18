// Readers for the prototyping jsonb columns of `projects` (spec, bom, netlist)
// and the build_route text column. The generated types give them as `Json` /
// `string`; the app's shapes live in spec.ts, bom-types.ts and netlist.ts.
//
// spec / bom / netlist are written only by this app, through those same types
// (the analysis, BOM and netlist code paths validate before saving), so the
// readers check the outer shape (a JSON object) and hand the value on as the
// app type. This is the ONE place that trust is stated; call sites stay free
// of casts.
import type { Json } from "@/lib/supabase/database.types";

import { BUILD_ROUTES, type BuildRoute } from "./analysis";
import type { ProjectBom } from "./bom-types";
import type { ProjectNetlist } from "./netlist";
import type { Spec } from "./spec";

type JsonObject = { [key: string]: Json | undefined };

function isJsonObject(v: Json | null | undefined): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** projects.spec as the app's Spec; null when unset or not an object. */
export function readSpec(v: Json | null | undefined): Spec | null {
  return isJsonObject(v) ? (v as Spec) : null;
}

/** projects.bom as the app's ProjectBom; null when unset or not an object. */
export function readBom(v: Json | null | undefined): ProjectBom | null {
  return isJsonObject(v) ? (v as ProjectBom) : null;
}

/** projects.netlist as the app's ProjectNetlist; null when unset or not an object. */
export function readNetlist(v: Json | null | undefined): ProjectNetlist | null {
  return isJsonObject(v) ? (v as unknown as ProjectNetlist) : null;
}

/** projects.build_route narrowed to a known route; anything else is null. */
export function readBuildRoute(v: string | null | undefined): BuildRoute | null {
  return (BUILD_ROUTES as readonly string[]).includes(v ?? "") ? (v as BuildRoute) : null;
}
