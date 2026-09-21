"use client";

// The prototyping workspace.
//
// Reads and writes through the browser client so a guest and a signed-in
// client behave identically — RLS scopes both to their own auth.uid(), the
// same arrangement the project workspace uses.
//
// Three panels: the project tree on the left, the selected node in the
// middle, and the next actions on the right. Each side panel collapses, and
// the whole thing mirrors in Arabic because the layout is built from logical
// properties and CSS grid.
//
// Every number on this page comes from lib/prototyping/readiness, mapped onto
// the tree by lib/prototyping/tree — nothing here counts anything itself.

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ListChecks,
  Loader2,
  Receipt,
  Send,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { looksLikeSchema, projectReadiness, type Requirement } from "@/lib/prototyping/readiness";
import { disciplineOf, isMakeable } from "@/lib/prototyping/parts";
import type { Spec } from "@/lib/prototyping/spec";
import {
  branches,
  nodeKey,
  nodeOf,
  nodeStates,
  partNode,
  toNode,
  visibleNodes,
  type NodeId,
} from "@/lib/prototyping/tree";
import type { Discipline, SchematicKind } from "@/lib/prototyping/constants";
import { IdeaStage } from "@/components/prototyping/idea-stage";
import { PartsList } from "@/components/prototyping/parts-list";
import { PartsStage } from "@/components/prototyping/parts-stage";
import { AddExistingDialog } from "@/components/prototyping/part-dialogs";
import { Recommendation } from "@/components/prototyping/recommendation";
import {
  SchematicsStage,
  createRevision,
  latestReady,
  type SchematicWithRevs,
} from "@/components/prototyping/schematics-stage";
import { TreeNav } from "@/components/prototyping/tree-nav";
import { ComponentsCard, PowerCard } from "@/components/prototyping/discipline-cards";
import { Card, GhostButton, PrimaryButton, Warn, useMono } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Project, ProjectPart, ProjectSchematicRevision } from "@/lib/supabase/types";

/** Which 2D template suits a part, from the process it is made by. */
function kindFor(part: ProjectPart): SchematicKind {
  if (part.process === "pcb_manufacturing") return "block_diagram";
  if (part.process === "laser_cutting") return "flat_pattern";
  if (part.process === "cnc_machining") return "bracket";
  return "outline";
}

/** Where a part's drawings are shown. */
const drawingsNode = (p: ProjectPart): NodeId =>
  disciplineOf(p) === "electronics" ? "electronics.board" : "mechanical.drawings";

/** How many open items the side panel offers as next actions. */
const NEXT_ACTIONS = 4;

export function PrototypingWorkspace({
  projectId,
  briefDestination,
}: {
  projectId: string;
  /** Who receives the brief text for analysis; null = our own server only. */
  briefDestination: string | null;
}) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const mono = useMono();
  const isRtl = useLocale() === "ar";

  const [project, setProject] = useState<Project | null>(null);
  const [parts, setParts] = useState<ProjectPart[]>([]);
  const [schematics, setSchematics] = useState<SchematicWithRevs[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [working, setWorking] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [briefCleared, setBriefCleared] = useState(false);
  const [branchSaveFailed, setBranchSaveFailed] = useState(false);
  const [specSaveFailed, setSpecSaveFailed] = useState(false);
  const [addingExisting, setAddingExisting] = useState(false);
  const specTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data: proj } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .maybeSingle();

    if (!proj) {
      setMissing(true);
      setLoading(false);
      return;
    }

    let loaded = proj as Project;
    if (looksLikeSchema(loaded.brief)) {
      // Database code was once pasted into a brief. It describes nothing, so
      // clear it and the reading that was taken from it.
      await supabase.from("projects").update({ brief: null, spec: null }).eq("id", projectId);
      loaded = { ...loaded, brief: null, spec: null };
      setBriefCleared(true);
    }
    setProject(loaded);

    const [partRes, schRes] = await Promise.all([
      supabase
        .from("project_parts")
        .select("*")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
      supabase
        .from("project_schematics")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
    ]);
    setParts((partRes.data ?? []) as ProjectPart[]);

    const schs = (schRes.data ?? []) as SchematicWithRevs[];
    if (schs.length) {
      const { data: revs } = await supabase
        .from("project_schematic_revisions")
        .select("*")
        .in(
          "schematic_id",
          schs.map((s) => s.id)
        )
        .order("rev", { ascending: true });
      const byId = new Map<string, ProjectSchematicRevision[]>();
      for (const r of (revs ?? []) as ProjectSchematicRevision[]) {
        byId.set(r.schematic_id, [...(byId.get(r.schematic_id) ?? []), r]);
      }
      setSchematics(schs.map((s) => ({ ...s, revs: byId.get(s.id) ?? [] })).filter((s) => s.revs.length));
    } else {
      setSchematics([]);
    }

    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="neu flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-mutedtext" />
      </div>
    );
  }

  if (missing || !project) {
    return (
      <div className="neu space-y-4 p-10 text-center">
        <p className="text-base text-mutedtext">{tProj("emptyList")}</p>
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
        >
          {tProj("listHeading")}
        </Link>
      </div>
    );
  }

  const spec = project.spec ?? null;
  const routeAccepted = project.stages?.manufacturing === "complete";
  const tr = (k: string, p?: Record<string, string | number>) => t(k, p);
  const ready = projectReadiness({ brief: project.brief, spec, parts, routeAccepted }, tr);
  const bs = branches(project.disciplines, project.brief, parts);
  const visible = visibleNodes(bs);
  const states = nodeStates(ready, parts, spec, visible, tr);
  const node = toNode(project.stage, visible);
  const open = ready.requirements.filter((r) => !r.satisfied);

  const designOf = (d: Discipline) => parts.filter((p) => disciplineOf(p) === d);
  const schematicsOf = (ps: ProjectPart[]) =>
    schematics.filter((s) => ps.some((p) => p.id === s.part_id));
  const drawn = schematics
    .map((s) => ({ s, rev: latestReady(s), part: parts.find((p) => p.id === s.part_id) }))
    .filter((x) => x.rev?.svg);
  // Codes are unique per project, so number past the highest one in use.
  const nextIndex =
    Math.max(0, ...parts.map((p) => parseInt(p.code.replace(/\D/g, ""), 10) || 0)) + 1;

  async function patchProject(changes: Partial<Project>) {
    setProject((p) => (p ? { ...p, ...changes } : p));
    return createClient().from("projects").update(changes).eq("id", project!.id);
  }

  /** Go to a node; with `focus`, bring the control that resolves it into view. */
  async function goTo(n: NodeId, focus?: string) {
    setShowOpen(false);
    await patchProject({ stage: n });
    if (focus) {
      setTimeout(() => {
        const el = document.getElementById(focus);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.focus({ preventScroll: true });
      }, 60);
    }
  }

  const goToRequirement = (r: Requirement) => goTo(nodeOf(r, parts, visible), r.focus);

  // Spec edits show at once; the write is debounced so typing a quantity
  // doesn't send a request per keystroke.
  function saveSpec(next: Spec) {
    setProject((p) => (p ? { ...p, spec: next } : p));
    setSpecSaveFailed(false);
    if (specTimer.current) clearTimeout(specTimer.current);
    specTimer.current = setTimeout(async () => {
      const { error } = await createClient().from("projects").update({ spec: next }).eq("id", projectId);
      if (error) setSpecSaveFailed(true);
    }, 400);
  }

  // A manual choice is stored beside what the analysis detected and always
  // wins over it; re-analysing only rewrites `detected`.
  async function setBranch(d: Discipline, on: boolean) {
    const before = project!.disciplines ?? null;
    const next = { ...(before ?? {}), manual: { ...(before?.manual ?? {}), [d]: on } };
    setBranchSaveFailed(false);
    const { error } = await patchProject({ disciplines: next });
    if (error) {
      setProject((p) => (p ? { ...p, disciplines: before } : p));
      setBranchSaveFailed(true);
    }
  }

  // The one progress fact that is a decision rather than a derivation: the
  // client accepting the route. It stays in projects.stages.
  async function acceptRoute(next: boolean) {
    await patchProject({
      stages: { ...project!.stages, manufacturing: next ? "complete" : "progress" },
    });
  }

  /** Draw a first schematic for a part, then show it. */
  async function generateSchematic(part: ProjectPart) {
    setWorking(true);
    const existing = schematics.find((s) => s.part_id === part.id) ?? null;
    await createRevision({
      schematic: existing,
      part,
      code: existing?.code ?? `SCH-${String(schematics.length + 1).padStart(2, "0")}`,
      title: part.name,
      kind: kindFor(part),
      materialLabel: part.material ? tProj(`material_${part.material}`) : "—",
      projectId: project!.id,
      errorText: (k, p) => t(k, p),
    });
    await goTo(drawingsNode(part));
    await load();
    setWorking(false);
  }

  const blockers = states[node]?.open ?? [];
  const following = visible[visible.indexOf(node) + 1] ?? null;

  const designStage = (d: Discipline) => (
    <PartsStage
      projectId={project.id}
      kind={d}
      parts={designOf(d)}
      nextIndex={nextIndex}
      onChanged={load}
      onGenerateSchematic={generateSchematic}
    />
  );

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <header className="neu flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <Link
          href={`/projects/${project.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-mutedtext transition-colors hover:text-heading"
        >
          <ArrowLeft className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
          {t("backToProject")}
        </Link>
        <span className="hidden h-6 w-px bg-borderstrong sm:block" />
        <div className="min-w-0 flex-1">
          <p className={mono("text-[10px] text-faint")}>{t("kicker")}</p>
          <h1 className="truncate text-base font-extrabold tracking-tight text-heading">
            {project.name}
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setShowOpen((v) => !v)}
          aria-expanded={showOpen}
          aria-controls="readiness-open"
          title={t("readinessCount", { done: ready.satisfiedCount, total: ready.totalCount })}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-panel"
        >
          <span className="hidden text-[11px] text-mutedtext sm:inline">{t("readiness")}</span>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel shadow-neu-inset">
            <span
              className="block h-full rounded-full bg-cobalt transition-[width] duration-500"
              style={{ width: `${ready.percent}%` }}
            />
          </span>
          <b className="font-mono text-[11px] font-medium tabular-nums text-heading">
            {ready.percent}%
          </b>
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-mutedtext transition-transform", showOpen && "rotate-180")}
          />
        </button>

        {showOpen && (
          <div id="readiness-open" className="neu-inset w-full space-y-2 p-4">
            <p className="text-xs font-bold text-heading">
              {open.length ? t("stillNeeded") : t("allSatisfied")}
            </p>
            {open.length > 0 && (
              <ul className="space-y-1">
                {open.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => goToRequirement(r)}
                      className="flex w-full items-start gap-2 rounded-md px-1 py-0.5 text-start text-[12px] text-heading transition-colors hover:text-cobalt"
                    >
                      <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-inventory" />
                      {r.blockingReason}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </header>

      <div
        className={cn(
          "grid items-start gap-4",
          collapsed.left && collapsed.right && "lg:grid-cols-[56px_minmax(0,1fr)_56px]",
          collapsed.left && !collapsed.right && "lg:grid-cols-[56px_minmax(0,1fr)_300px]",
          !collapsed.left && collapsed.right && "lg:grid-cols-[248px_minmax(0,1fr)_56px]",
          !collapsed.left && !collapsed.right && "lg:grid-cols-[248px_minmax(0,1fr)_300px]"
        )}
      >
        {/* Project tree */}
        <aside className="neu p-3">
          <div className="flex items-center justify-end pb-2">
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
              aria-label={collapsed.left ? t("expand") : t("collapse")}
              className="rounded-md p-1 text-mutedtext transition-colors hover:text-cobalt"
            >
              {collapsed.left !== isRtl ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>

          <TreeNav
            branches={bs}
            states={states}
            current={node}
            collapsed={collapsed.left}
            saveFailed={branchSaveFailed}
            onSelect={goTo}
            onBranch={setBranch}
          />

          {!collapsed.left && drawn.length > 0 && (
            <div className="neu-inset mt-3 space-y-2 p-4">
              <p className="text-xs font-bold text-heading">{t("schHeading")}</p>
              <ul className="grid grid-cols-3 gap-2">
                {drawn.map(({ s, rev, part }) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => goTo(part ? drawingsNode(part) : "mechanical.drawings")}
                      title={`${s.code} · ${s.title}`}
                      className="block w-full space-y-1 rounded-lg bg-surface p-1 shadow-neu-sm transition-shadow hover:ring-2 hover:ring-cobalt/40"
                    >
                      {/* Generated locally by lib/prototyping/schematic.ts. As an
                          <img> data URI nothing inside the SVG can run. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(rev!.svg!)}`}
                        alt={`${s.code} ${s.title}`}
                        className="aspect-[4/3] w-full rounded bg-white object-contain"
                      />
                      <span className="block truncate font-mono text-[9px] text-faint">
                        {s.code}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* Selected node */}
        <main className="min-w-0 space-y-4">
          {briefCleared && node === "brief" && (
            <Warn
              blocking={false}
              action={
                <GhostButton onClick={() => setBriefCleared(false)}>{t("dismiss")}</GhostButton>
              }
            >
              {t("briefCleared")}
            </Warn>
          )}
          {specSaveFailed && <Warn blocking>{t("specSaveFailed")}</Warn>}

          {node === "brief" && (
            // Remounts when the brief is cleared, so the editor drops its copy.
            <IdeaStage
              key={briefCleared ? "cleared" : "brief"}
              project={project}
              parts={parts}
              onChanged={load}
              onSpec={saveSpec}
            />
          )}

          {node === "parts" && (
            <PartsList
              projectId={project.id}
              parts={parts}
              nextIndex={nextIndex}
              onChanged={load}
              onOpen={(p) => goTo(partNode(p))}
            />
          )}

          {node === "mechanical.parts" && designStage("mechanical")}

          {node === "mechanical.drawings" && (
            <>
              <SchematicsStage
                projectId={project.id}
                parts={parts}
                schematics={schematicsOf(designOf("mechanical"))}
                onChanged={load}
              />
              {/* 3D CAD is still a human service; say so where drawings live. */}
              <div className="neu flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
                <p className="min-w-0 flex-1 text-[12px] text-mutedtext">{t("engineeringBody")}</p>
                <Link
                  href="/design/drawing"
                  className="text-xs font-semibold text-cobalt hover:text-cobalt-hover"
                >
                  {t("engineeringCta")}
                </Link>
                <Link
                  href={`/projects/${project.id}`}
                  className="text-xs font-semibold text-mutedtext hover:text-heading"
                >
                  {t("haveCad")}
                </Link>
              </div>
            </>
          )}

          {node === "mechanical.process" && (
            <Recommendation
              parts={designOf("mechanical")}
              brief={project.brief ?? ""}
              accepted={routeAccepted}
            />
          )}

          {node === "electronics.board" && (
            <>
              {designStage("electronics")}
              {schematicsOf(designOf("electronics")).length > 0 && (
                <SchematicsStage
                  projectId={project.id}
                  parts={parts}
                  schematics={schematicsOf(designOf("electronics"))}
                  onChanged={load}
                />
              )}
            </>
          )}

          {node === "electronics.power" && (
            <PowerCard spec={spec} onSet={() => goTo("brief", "fact-power")} />
          )}

          {node === "electronics.components" && (
            <ComponentsCard
              onAddExisting={() => setAddingExisting(true)}
              onOpenList={() => goTo("parts")}
            />
          )}

          {node === "software.scope" && designStage("software")}

          {node === "quote" && (
            <>
              <Recommendation
                parts={parts.filter(isMakeable)}
                brief={project.brief ?? ""}
                accepted={routeAccepted}
                onAccept={acceptRoute}
              />
              <Card kicker={t("node_quote")} title={t("stageTitle_quote")} intro={t("quoteIntro")}>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href="/design/quote"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    {t("requestQuote")}
                  </Link>
                  <span className="text-[11px] text-mutedtext">{t("quoteNote")}</span>
                </div>
              </Card>
            </>
          )}

          {/* Footer: the one forward action, named for where it goes. */}
          <div className="neu flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setShowOpen(true)}
              className="text-[11px] text-mutedtext transition-colors hover:text-cobalt"
            >
              {t("openItems", { count: open.length })}
            </button>
            <span className="flex-1" />
            {following && (
              // Disabled buttons swallow hover in some browsers, so the
              // reason sits on a wrapper.
              <span
                title={
                  blockers.length
                    ? t("continueBlocked", {
                        items: blockers.map((b) => b.blockingReason).join(" · "),
                      })
                    : undefined
                }
              >
                <PrimaryButton
                  onClick={() => goTo(following)}
                  disabled={blockers.length > 0 || working}
                >
                  {t("continueTo", { node: t(nodeKey(following)) })}
                  <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
                </PrimaryButton>
              </span>
            )}
          </div>
        </main>

        {/* Next actions */}
        <aside className="neu p-4">
          <div className="flex items-center justify-between gap-2">
            {!collapsed.right && (
              <p className="flex items-center gap-1.5 text-sm font-bold text-heading">
                <ListChecks className="h-4 w-4 text-cobalt" />
                {t("nextActions")}
              </p>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
              aria-label={collapsed.right ? t("expand") : t("collapse")}
              className="rounded-md p-1 text-mutedtext transition-colors hover:text-cobalt"
            >
              {collapsed.right !== isRtl ? (
                <ChevronLeft className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          </div>

          {!collapsed.right && (
            <div className="mt-4 space-y-4">
              {open.length ? (
                <ul className="space-y-1.5">
                  {open.slice(0, NEXT_ACTIONS).map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => goToRequirement(r)}
                        className="flex w-full items-start gap-2 rounded-xl bg-panel px-3 py-2.5 text-start text-[12px] font-medium text-heading shadow-neu-sm transition-colors hover:text-cobalt"
                      >
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-inventory" />
                        <span className="min-w-0 flex-1">{r.blockingReason}</span>
                        <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50 rtl:rotate-180" />
                      </button>
                    </li>
                  ))}
                  {open.length > NEXT_ACTIONS && (
                    <li>
                      <GhostButton onClick={() => setShowOpen(true)} className="px-1">
                        {t("moreOpen", { count: open.length - NEXT_ACTIONS })}
                      </GhostButton>
                    </li>
                  )}
                </ul>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12px] text-mutedtext">{t("allSatisfied")}</p>
                  <PrimaryButton onClick={() => goTo("quote")}>
                    <Receipt className="h-3.5 w-3.5" />
                    {t("requestQuote")}
                  </PrimaryButton>
                </div>
              )}

              <p className="flex items-start gap-1.5 border-t border-borderstrong/40 pt-3 text-[10.5px] leading-relaxed text-faint">
                <Send className="mt-0.5 h-3 w-3 shrink-0 rtl:-scale-x-100" />
                {briefDestination
                  ? t("briefSentTo", { destination: briefDestination })
                  : t("briefStaysHere")}
              </p>
            </div>
          )}

          {collapsed.right && open.length > 0 && (
            <div className="mt-3 flex flex-col items-center">
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-inventory-bg px-1.5 font-mono text-[10px] font-semibold text-inventory">
                {open.length}
              </span>
            </div>
          )}
        </aside>
      </div>

      {addingExisting && (
        <AddExistingDialog
          projectId={project.id}
          nextIndex={nextIndex}
          onClose={() => setAddingExisting(false)}
          onAdded={load}
        />
      )}
    </div>
  );
}
