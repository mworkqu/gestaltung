// The owner-only diagnostic export: everything one project holds, in one JSON.
// Server-only. Read by /api/admin/projects/<id>/export (super_admin).
//
// Nothing is redacted except API keys (redactKeys at the end). The raw
// provider reply sits beside the parsed result for every analysis and circuit
// run, so a wrong answer can be traced to the model or to our parsing.
// Everything computed here (readiness, BOM matches, circuit checks, drawings)
// is computed by the same code the page uses, so the file shows what the
// client saw. Sections that could not be read say why in `_notes`.

import type { SupabaseClient } from "@supabase/supabase-js";
import { getTranslations } from "next-intl/server";

import { matchProjectBom } from "@/lib/prototyping/bom-server";
import { orderQty, type ProjectBom } from "@/lib/prototyping/bom";
import { effectiveShape, missingDims, renderDimensionDrawing, DIMS, type Dim } from "@/lib/prototyping/dimension-drawing";
import { sanityChecks, type ProjectNetlist } from "@/lib/prototyping/netlist";
import { disciplineOf, isConcept, partNeeds } from "@/lib/prototyping/parts";
import { projectReadiness, wordCount } from "@/lib/prototyping/readiness";
import type { Spec } from "@/lib/prototyping/spec";
import { branches } from "@/lib/prototyping/tree";
import type { Project, ProjectPart } from "@/lib/supabase/types";

export const EXPORT_VERSION = 1;

type Row = Record<string, unknown>;

/** Where a project stands, in one word the admin list can filter and sort by. */
export function projectStatus(p: Pick<Project, "brief" | "spec" | "bom" | "netlist">): string {
  const spec = p.spec as Spec | null | undefined;
  if (!p.brief?.trim()) return "empty";
  if (!spec) return "brief_written";
  if (!spec.confirmed) return "analysed";
  if (p.netlist) return "circuit_generated";
  if ((p.bom as ProjectBom | null | undefined)?.lines?.length) return "bom_ready";
  return "understanding_confirmed";
}

/** Arabic, English or both, from the script actually used. */
function briefLanguage(text: string): "ar" | "en" | "mixed" | null {
  const ar = (text.match(/[؀-ۿ]/g) ?? []).length;
  const la = (text.match(/[A-Za-z]/g) ?? []).length;
  if (!ar && !la) return null;
  if (ar && la && Math.min(ar, la) / (ar + la) > 0.15) return "mixed";
  return ar > la ? "ar" : "en";
}

/** Replace anything shaped like an API key, and the live key values themselves. */
export function redactKeys<T>(value: T): T {
  const live = [
    process.env.GEMINI_API_KEY,
    process.env.GROQ_API_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.RESEND_API_KEY,
  ].filter((k): k is string => !!k && k.length > 12);
  const patterns = [
    /AIza[0-9A-Za-z_-]{20,}/g,
    /\bAQ\.[A-Za-z0-9_-]{20,}/g,
    /\bgsk_[A-Za-z0-9]{20,}/g,
    /\bsk-[A-Za-z0-9_-]{20,}/g,
    /\bre_[A-Za-z0-9_]{20,}/g,
    /\bsb_secret_[A-Za-z0-9_-]{10,}/g,
  ];
  const clean = (s: string) => {
    let out = s;
    for (const k of live) out = out.split(k).join("[REDACTED API KEY]");
    for (const p of patterns) out = out.replace(p, "[REDACTED API KEY]");
    return out;
  };
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? clean(v)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(value) as T;
}

export async function buildProjectExport(
  db: SupabaseClient,
  projectId: string,
  opts: { service: SupabaseClient | null; exportedBy: string }
): Promise<Row | null> {
  const notes: string[] = [];
  const { data: projectRow, error: projErr } = await db.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (projErr) throw projErr;
  if (!projectRow) return null;
  const project = projectRow as Project & { bom?: ProjectBom | null; netlist?: ProjectNetlist | null };

  const soft = async <T>(label: string, q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T | null> => {
    const { data, error } = await q;
    if (error) {
      notes.push(`${label}: not readable (${error.message})`);
      return null;
    }
    return data;
  };

  const [parts, runs, events, usage, schematics, profile, kits, orderLines] = await Promise.all([
    soft<ProjectPart[]>("parts", db.from("project_parts").select("*").eq("project_id", projectId).order("position")),
    soft<Row[]>("analysis runs", db.from("analysis_runs").select("*").eq("project_id", projectId).order("created_at")),
    soft<Row[]>("event log", db.from("project_events").select("*").eq("project_id", projectId).order("created_at")),
    soft<Row[]>("ai usage", db.from("ai_usage").select("*").eq("project_id", projectId).order("created_at")),
    soft<Row[]>(
      "legacy schematics",
      db.from("project_schematics").select("*, revisions:project_schematic_revisions(*)").eq("project_id", projectId)
    ),
    soft<Row>("owner profile", db.from("profiles").select("id, full_name, role, phone, locale").eq("id", project.user_id).maybeSingle()),
    soft<Row[]>("kits", db.from("project_kits").select("*").eq("project_id", projectId).order("created_at")),
    soft<Row[]>(
      "orders",
      db.from("part_order_items").select("*, order:part_orders(id, status, total_qar, discount_qar, created_at)").eq("project_id", projectId)
    ),
  ]);
  const allParts = parts ?? [];

  // Owner identity: the auth record needs the service key (production has it).
  let owner: Row = { id: project.user_id, profile };
  if (opts.service) {
    const { data } = await opts.service.auth.admin.getUserById(project.user_id);
    if (data?.user)
      owner = {
        ...owner,
        email: data.user.email ?? null,
        isAnonymous: (data.user as { is_anonymous?: boolean }).is_anonymous ?? null,
        signedUpAt: data.user.created_at,
        lastSignInAt: data.user.last_sign_in_at ?? null,
      };
  } else notes.push("owner email: SUPABASE_SERVICE_ROLE_KEY not set on this server, so only the profile is shown");

  const spec = (project.spec ?? null) as Spec | null;
  const bom = project.bom ?? null;
  const netlist = project.netlist ?? null;

  const matches = await matchProjectBom(db, bom, project.user_id).catch((e) => {
    notes.push(`bom matches: failed (${e instanceof Error ? e.message : String(e)})`);
    return [];
  });
  const matchOf = new Map(matches.map((m) => [m.lineId, m]));

  const t = await getTranslations({ locale: "en", namespace: "Prototyping" });
  const tProj = await getTranslations({ locale: "en", namespace: "Projects" });
  const tr = (k: string, p?: Record<string, string | number>) => t(k, p);
  const readiness = projectReadiness(
    {
      brief: project.brief,
      spec,
      parts: allParts,
      routeAccepted: project.stages?.manufacturing === "complete",
      bom: bom ? { lines: bom.lines, matches: matchOf } : null,
    },
    tr
  );

  const ev = events ?? [];
  const lastEvent = (type: string, match?: (d: Row) => boolean) =>
    [...ev].reverse().find((e) => e.type === type && (!match || match((e.detail ?? {}) as Row)))?.created_at ?? null;

  const analyseRuns = (runs ?? []).filter((r) => r.feature === "analyse");
  const latest = analyseRuns[analyseRuns.length - 1] ?? null;
  const runView = (r: Row) => ({
    id: r.id,
    feature: r.feature,
    provider: r.provider,
    model: r.model,
    attempt: r.attempt,
    runAt: r.created_at,
    actor: r.user_id,
    outcome: r.outcome,
    error: r.error,
    rawResponse: r.raw_text,
    rawResponseJson: r.raw_response,
    parsedResponse: r.parsed_response,
  });
  if (!runs?.length) notes.push("analysis: no recorded runs (raw responses are kept from migration 0024 on)");

  const bs = branches(project.disciplines, project.brief, allParts);

  const drawingLabels = (p: ProjectPart) => ({
    dim: Object.fromEntries(DIMS.map((d) => [d, t(`dim_${d}`)])) as Record<Dim, string>,
    missing: (what: string) => t("dimMissing", { what }),
    noShape: t("dimNoShape"),
    front: t("viewFront"),
    top: t("viewTop"),
    side: t("viewSide"),
    flat: t("viewFlat"),
    thickness: (mm: string) => t("dimThickness", { mm }),
    dxfNote: t("dxfNote"),
    title: { part: t("tbPart"), material: t("material"), process: t("process"), quantity: t("tbQuantity"), scale: t("tbScale"), units: t("tbUnits") },
    materialName: p.material ? tProj(`material_${p.material}`) : t("unset"),
    processName: p.process ? t(`process_${p.process}`) : t("unset"),
  });

  const out: Row = {
    exportedAt: new Date().toISOString(),
    exportVersion: EXPORT_VERSION,
    exportedBy: opts.exportedBy,
    project: {
      id: project.id,
      name: project.name,
      owner,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      status: projectStatus(project),
      selectedNode: project.stage,
      buildRoute: (project as { build_route?: string | null }).build_route ?? null,
      stages: project.stages,
      notes: project.notes,
    },
    brief: {
      text: project.brief,
      language: project.brief ? briefLanguage(project.brief) : null,
      wordCount: wordCount(project.brief ?? ""),
      charCount: (project.brief ?? "").length,
      lastEditedAt: lastEvent("brief_edited") ?? null,
      lastEditedAtSource: lastEvent("brief_edited") ? "event log" : "unknown (no brief_edited event recorded)",
    },
    analysis: latest
      ? { ...runView(latest), specProvider: spec?.provider ?? null, specFallback: spec?.fallback ?? null }
      : { provider: spec?.provider ?? null, fallback: spec?.fallback ?? null, runAt: null, rawResponse: null, parsedResponse: null },
    analysisHistory: (runs ?? []).map(runView),
    summary: spec?.summary ?? null,
    understandingConfirmed: spec?.confirmed ?? false,
    disciplines: {
      stored: project.disciplines ?? null,
      branches: bs.map((b) => ({ discipline: b.discipline, active: b.active, detected: b.detected, manual: b.manual ?? null, toDesignParts: b.partCount })),
    },
    requirements: (spec?.rows ?? []).map((r) => ({
      id: r.id,
      label: r.label,
      value: r.value,
      source: r.edited ? "user" : r.source,
      originalSource: r.source,
      edited: r.edited,
      analysisValue: r.analysisValue ?? null,
    })),
    userAnswers: (spec?.questions ?? []).map((q) => {
      const row = spec?.rows.find((r) => r.id === q.id);
      return {
        id: q.id,
        question: q.label,
        type: q.type,
        options: q.options ?? null,
        answered: !!row?.edited,
        answer: row?.edited ? row.value : null,
        notDecidedYet: !!row?.edited && row.value === null,
        answeredAt: lastEvent("answer_given", (d) => d.id === q.id),
      };
    }),
    parts: allParts.map((p) => ({
      ...p,
      source: p.source ?? "to_design",
      discipline: disciplineOf(p),
      concept: isConcept(p),
      needs: partNeeds(p),
    })),
    bom: (bom?.lines ?? []).map((l) => {
      const m = matchOf.get(l.id);
      const prod = m?.product ?? null;
      const qty = prod ? orderQty(l.quantity, prod) : l.quantity;
      return {
        ...l,
        status: m?.status ?? null,
        product: prod
          ? { id: prod.id, sku: prod.sku, name: prod.name, unitPrice: Number(prod.unit_price), stockStatus: prod.stock_status, minOrderQty: prod.min_order_qty }
          : null,
        orderQuantity: qty,
        lineTotal: prod && !m?.have ? Math.round(Number(prod.unit_price) * qty * 100) / 100 : null,
        candidates: (m?.candidates ?? []).map((c) => ({
          id: c.id,
          sku: c.sku,
          name: c.name,
          unitPrice: Number(c.unit_price),
          stockStatus: c.stock_status,
          packSize: c.pack_size ?? 1,
          strength: c.strength,
          why: c.why,
        })),
        alreadyHave: m?.have ?? null,
      };
    }),
    bomAnalysedAt: bom?.analysedAt ?? null,
    bomDismissed: bom?.dismissed ?? [],
    electronics: {
      builtAt: bom?.electronicsBuiltAt ?? null,
      builtForRoute: bom?.route ?? null,
      routeRecommendation: spec?.routeRecommendation ?? null,
      levelFlags: bom?.levelFlags ?? [],
      assumptions: bom?.assumptions ?? [],
    },
    kits: kits ?? [],
    orderLines: orderLines ?? [],
    netlist: netlist ? { ...netlist, checks: sanityChecks(netlist) } : null,
    drawings: {
      dimensionDrawings: allParts
        .filter((p) => disciplineOf(p) === "mechanical" && !isConcept(p))
        .map((p) => ({
          partId: p.id,
          code: p.code,
          name: p.name,
          shape: p.shape ?? null,
          drawnAs: effectiveShape(p),
          dimensionsMm: Object.fromEntries(DIMS.map((d) => [d, p[d] ?? null])),
          missing: missingDims(p),
          svg: renderDimensionDrawing(p, drawingLabels(p)),
        })),
      legacySchematics: schematics ?? [],
    },
    readiness,
    aiUsage: usage ?? [],
    eventLog: ev.map((e) => ({ ...e, actorIsOwner: e.actor === project.user_id })),
    _notes: notes,
  };
  if (!events?.length) notes.push("event log: empty (events are recorded from migration 0024 on)");
  return redactKeys(out);
}
