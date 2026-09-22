// Builds (or rebuilds) a project's electronics bill of materials. Server-only.
//
//   1. the model lists boards, modules, sensors, actuators (listElectronics),
//      unless we are only redrawing the circuit for the lines already there;
//   2. the model wires them (generateNetlist) — validated, one retry;
//   3. OUR rules derive the passives, level shifters, build consumables and,
//      on the Custom PCB route, the fabrication line (deriveElectronics);
//   4. each source replaces only its own lines; picks, bought lines and the
//      client's removals are kept (replaceLines).
//
// If the circuit cannot be validated, the list is still saved with its
// consumables, and the caller is told the passives could not be derived.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";

import type { BuildRoute } from "./analysis";
import { originOf, replaceLines, type ProjectBom, type ProjectLine } from "./bom";
import { deriveElectronics } from "./electronics-rules";
import { generateNetlist, listElectronics } from "./electronics-gen";
import type { Netlist, ProjectNetlist } from "./netlist";
import type { Spec } from "./spec";

export type BuildOutcome =
  | { ok: true; bom: ProjectBom; netlist: ProjectNetlist | null; circuit: "ok" | "failed"; problems: string[] }
  | { ok: false; error: string; problems: string[] };

type ProjectRow = {
  id: string;
  brief: string | null;
  spec: Spec | null;
  bom: ProjectBom | null;
  netlist: ProjectNetlist | null;
  build_route: BuildRoute | null;
};

export async function buildElectronics(opts: {
  supabase: SupabaseClient;
  project: ProjectRow;
  locale: "en" | "ar";
  /** false = keep the current electronics lines and only redraw + re-derive. */
  relist: boolean;
}): Promise<BuildOutcome> {
  const { supabase, project, locale } = opts;
  const route: BuildRoute = project.build_route ?? "prototype";
  const spec = project.spec;
  const summary = spec?.summary || project.brief || "";
  const facts = (spec?.rows ?? []).map((r) => `- ${r.label}: ${r.value ?? "not decided yet"}`).join("\n");
  const t = await getTranslations({ locale, namespace: "Prototyping" });
  const tr = (k: string, p?: Record<string, string | number>) => t(k, p);

  let lines: ProjectLine[];
  if (opts.relist) {
    const listed = await listElectronics({ supabase, projectId: project.id, summary, facts, route, locale });
    if (!listed.ok) return { ok: false, error: listed.error, problems: listed.problems };
    lines = listed.value;
  } else {
    // Redraw only: the builder's lines, or — for projects analysed before the
    // builder existed — the analysis's electronics lines.
    const current = project.bom?.lines ?? [];
    lines = current.filter((l) => originOf(l) === "electronics");
    if (!lines.length) lines = current.filter((l) => originOf(l) === "analysis" && l.kind === "electronics");
    if (!lines.length) return { ok: false, error: "no_electronics", problems: [] };
  }

  const drawn = await generateNetlist({ supabase, projectId: project.id, summary, lines, locale });
  const netlist: Netlist | null = drawn.ok ? drawn.value : null;
  if (!drawn.ok && (drawn.error === "paused" || drawn.error === "unavailable" || drawn.error === "rate_limited") && !opts.relist)
    return { ok: false, error: drawn.error, problems: drawn.problems };

  const power = spec?.rows.find((r) => r.id === "power")?.value ?? null;
  const derived = deriveElectronics({ netlist, lines, route, power, t: tr });
  const dismissed = new Set(project.bom?.dismissed ?? []);

  let bom = project.bom;
  if (opts.relist) bom = replaceLines(bom, ["electronics"], lines);
  bom = replaceLines(
    bom,
    ["rule"],
    derived.lines.filter((l) => !dismissed.has(l.id))
  );
  const saved: ProjectBom & Record<string, unknown> = {
    ...bom,
    electronicsBuiltAt: new Date().toISOString(),
    route,
    levelFlags: derived.levelFlags,
    assumptions: derived.assumptions,
  };
  const savedNetlist: ProjectNetlist | null = netlist
    ? { ...netlist, generatedAt: new Date().toISOString(), model: drawn.ok ? drawn.model : null }
    : project.netlist;

  const { error } = await supabase
    .from("projects")
    .update({ bom: saved, ...(netlist ? { netlist: savedNetlist } : {}) })
    .eq("id", project.id);
  if (error) return { ok: false, error: "not_ready", problems: [error.message] };

  return {
    ok: true,
    bom: saved,
    netlist: savedNetlist,
    circuit: drawn.ok ? "ok" : "failed",
    problems: drawn.ok ? [] : drawn.problems,
  };
}
