"use client";

// The prototyping workspace.
//
// Reads and writes through the browser client so a guest and a signed-in
// client behave identically — RLS scopes both to their own auth.uid(), the
// same arrangement the project workspace uses.
//
// Three panels: stages on the left, the active stage in the middle, and a
// panel on the right that says plainly what the assistant is and is not. Each
// side panel collapses, and the whole thing mirrors in Arabic because the
// layout is built from logical properties and CSS grid.
//
// Every number and every stage status on this page comes from
// lib/prototyping/readiness — nothing here counts anything itself.

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Cpu,
  Factory,
  Layers,
  Lightbulb,
  Loader2,
  Lock,
  PencilRuler,
  Plus,
  Receipt,
  Sparkles,
  Truck,
  Wrench,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { LEGACY_SUBJECT_CLAIMS } from "@/lib/prototyping/engine";
import {
  GROUP_STAGE,
  STAGE_GROUPS,
  looksLikeSchema,
  projectReadiness,
  stageStatuses,
  type RequirementGroup,
} from "@/lib/prototyping/readiness";
import {
  STAGES,
  nextStage,
  type SchematicKind,
  type Stage,
  type StageStatus,
} from "@/lib/prototyping/constants";
import { IdeaStage } from "@/components/prototyping/idea-stage";
import { PartsStage } from "@/components/prototyping/parts-stage";
import { Recommendation } from "@/components/prototyping/recommendation";
import {
  SchematicsStage,
  createRevision,
  latestReady,
  type SchematicWithRevs,
} from "@/components/prototyping/schematics-stage";
import {
  Card,
  GhostButton,
  PrimaryButton,
  SoftButton,
  Warn,
  useMono,
} from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type {
  Project,
  ProjectClaim,
  ProjectPart,
  ProjectSchematicRevision,
} from "@/lib/supabase/types";

const STAGE_ICON: Record<Stage, typeof Lightbulb> = {
  idea: Lightbulb,
  concepts: Sparkles,
  parts: Layers,
  design: PencilRuler,
  engineering: Wrench,
  manufacturing: Factory,
  quote: Receipt,
  production: Truck,
};

const GROUPS: RequirementGroup[] = ["brief", "understanding", "parts", "route"];

const STATUS_TEXT: Record<StageStatus, string> = {
  complete: "text-buy",
  progress: "text-cobalt",
  needs: "text-inventory",
  optional: "text-mutedtext",
  locked: "text-faint",
};

const STATUS_DOT: Record<StageStatus, string> = {
  complete: "bg-buy",
  progress: "bg-cobalt",
  needs: "bg-inventory",
  optional: "bg-borderstrong",
  locked: "bg-faint",
};

/** Which 2D template suits a part, from the process it is made by. */
function kindFor(part: ProjectPart): SchematicKind {
  if (part.process === "pcb_manufacturing") return "block_diagram";
  if (part.process === "laser_cutting") return "flat_pattern";
  if (part.process === "cnc_machining") return "bracket";
  return "outline";
}

export function PrototypingWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("Prototyping");
  const tProj = useTranslations("Projects");
  const mono = useMono();
  const isRtl = useLocale() === "ar";

  const [project, setProject] = useState<Project | null>(null);
  const [claims, setClaims] = useState<ProjectClaim[]>([]);
  const [parts, setParts] = useState<ProjectPart[]>([]);
  const [schematics, setSchematics] = useState<SchematicWithRevs[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [working, setWorking] = useState(false);
  const [openAnyway, setOpenAnyway] = useState(false);
  const [showOpen, setShowOpen] = useState(false);
  const [briefCleared, setBriefCleared] = useState(false);

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
      // clear it, along with the unconfirmed claims that were read out of it.
      await supabase.from("projects").update({ brief: null }).eq("id", projectId);
      await supabase
        .from("project_claims")
        .delete()
        .eq("project_id", projectId)
        .eq("status", "pending");
      loaded = { ...loaded, brief: null };
      setBriefCleared(true);
    }
    setProject(loaded);

    const [claimRes, partRes, schRes] = await Promise.all([
      supabase
        .from("project_claims")
        .select("*")
        .eq("project_id", projectId)
        .order("position", { ascending: true }),
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

    // The retired "confirm the summary" claim pointed at a summary that never
    // existed. Drop any rows written before it was removed.
    let claimRows = (claimRes.data ?? []) as ProjectClaim[];
    const legacy = claimRows.filter((c) => LEGACY_SUBJECT_CLAIMS.includes(c.text));
    if (legacy.length) {
      await supabase
        .from("project_claims")
        .delete()
        .in(
          "id",
          legacy.map((c) => c.id)
        );
      claimRows = claimRows.filter((c) => !legacy.includes(c));
    }
    setClaims(claimRows);
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

  const stage = (STAGES as readonly string[]).includes(project.stage)
    ? (project.stage as Stage)
    : "idea";
  const routeAccepted = project.stages?.manufacturing === "complete";

  // Only schematics with a drawing we can actually show count as drawn.
  const drawn = schematics
    .map((s) => ({ s, rev: latestReady(s) }))
    .filter((x) => x.rev?.svg);

  const readinessInput = {
    brief: project.brief,
    claims,
    parts,
    routeAccepted,
    schematicPartIds: drawn.map((x) => x.s.part_id).filter((id): id is string => !!id),
  };
  const ready = projectReadiness(readinessInput, (k, p) => t(k, p));
  const states = stageStatuses(readinessInput, ready);
  const open = ready.requirements.filter((r) => !r.satisfied);
  const partReqs = ready.requirements.filter((r) => r.group === "parts");

  async function patchProject(changes: Partial<Project>) {
    setProject((p) => (p ? { ...p, ...changes } : p));
    await createClient().from("projects").update(changes).eq("id", project!.id);
  }

  /** `force` shows the stage even while it waits on a prerequisite. */
  async function goToStage(next: Stage, force = false) {
    setOpenAnyway(force);
    setShowOpen(false);
    await patchProject({ stage: next });
  }

  // The one stage fact that is a decision rather than a derivation: the client
  // accepting the route. It stays in projects.stages.
  async function acceptRoute(next: boolean) {
    await patchProject({
      stages: { ...project!.stages, manufacturing: next ? "complete" : "progress" },
    });
  }

  /** Draw a first schematic for a part, then jump to the design stage. */
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
    await goToStage("design", true);
    await load();
    setWorking(false);
  }

  const current = states[stage];
  const locked = current.status === "locked" && !openAnyway;
  const blockers = open.filter((r) => STAGE_GROUPS[stage].includes(r.group));
  const following = nextStage(stage);

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
                      onClick={() => goToStage(GROUP_STAGE[r.group])}
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
          collapsed.left && !collapsed.right && "lg:grid-cols-[56px_minmax(0,1fr)_320px]",
          !collapsed.left && collapsed.right && "lg:grid-cols-[248px_minmax(0,1fr)_56px]",
          !collapsed.left && !collapsed.right && "lg:grid-cols-[248px_minmax(0,1fr)_320px]"
        )}
      >
        {/* Stages */}
        <aside className="neu p-3">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            {!collapsed.left && (
              <span className={mono("text-[10px] text-faint")}>{t("kicker")}</span>
            )}
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

          <ol className="space-y-1">
            {STAGES.map((s, i) => {
              const Icon = STAGE_ICON[s];
              const st = states[s].status;
              const activeStage = s === stage;
              return (
                <li key={s}>
                  <button
                    type="button"
                    onClick={() => goToStage(s)}
                    aria-current={activeStage ? "step" : undefined}
                    title={`${t(`stage_${s}`)} — ${t(`status_${st}`)}`}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg p-2 text-start transition-colors",
                      activeStage
                        ? "bg-panel text-heading shadow-neu-inset"
                        : "text-mutedtext hover:text-heading",
                      collapsed.left && "justify-center"
                    )}
                  >
                    <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-surface shadow-neu-sm">
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          st === "locked" ? "text-faint" : "text-cobalt"
                        )}
                        strokeWidth={1.6}
                      />
                      {collapsed.left && (
                        <span
                          className={cn(
                            "absolute -top-0.5 h-2 w-2 rounded-full ring-2 ring-surface",
                            isRtl ? "-start-0.5" : "-end-0.5",
                            STATUS_DOT[st]
                          )}
                        />
                      )}
                    </span>
                    {!collapsed.left && (
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-1.5 text-sm font-semibold">
                          {t(`stage_${s}`)}
                          <span className="font-mono text-[10px] font-medium text-faint">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 flex items-center gap-1 text-[11px] font-medium",
                            STATUS_TEXT[st]
                          )}
                        >
                          {st === "complete" && <Check className="h-3 w-3" />}
                          {st === "needs" && <CircleAlert className="h-3 w-3" />}
                          {st === "locked" && <Lock className="h-3 w-3" />}
                          {t(`status_${st}`)}
                        </span>
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          {!collapsed.left && (
            <div className="neu-inset mt-3 space-y-3 p-4">
              <div>
                <p className="text-xs font-bold text-heading">{t("readinessTitle")}</p>
                <p className="mt-0.5 text-[11px] text-mutedtext">{t("readinessSub")}</p>
              </div>
              <ul className="space-y-1.5">
                {GROUPS.map((g) => {
                  const rs = ready.requirements.filter((r) => r.group === g);
                  const ok = rs.filter((r) => r.satisfied).length;
                  const done = ok === rs.length;
                  return (
                    <li key={g}>
                      <button
                        type="button"
                        onClick={() => goToStage(GROUP_STAGE[g])}
                        className={cn(
                          "flex w-full items-center gap-2 text-start text-[11.5px] transition-colors hover:text-cobalt",
                          done ? "text-heading" : "text-mutedtext"
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-4 w-4 shrink-0 place-items-center rounded-full",
                            done ? "bg-buy-bg text-buy" : "bg-surface text-faint shadow-neu-sm"
                          )}
                        >
                          {done && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className="min-w-0 flex-1">{t(`ready_${g}`)}</span>
                        {rs.length > 1 && (
                          <span className="font-mono text-[10px] tabular-nums text-faint">
                            {ok}/{rs.length}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {!collapsed.left && drawn.length > 0 && (
            <div className="neu-inset mt-3 space-y-2 p-4">
              <p className="text-xs font-bold text-heading">{t("schHeading")}</p>
              <ul className="grid grid-cols-3 gap-2">
                {drawn.map(({ s, rev }) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => goToStage("design", true)}
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

        {/* Active stage */}
        <main className="min-w-0 space-y-4">
          {briefCleared && stage === "idea" && (
            <Warn
              blocking={false}
              action={
                <GhostButton onClick={() => setBriefCleared(false)}>{t("dismiss")}</GhostButton>
              }
            >
              {t("briefCleared")}
            </Warn>
          )}

          {locked ? (
            <Card>
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-surface text-faint shadow-neu-sm">
                  <Lock className="h-6 w-6" strokeWidth={1.5} />
                </span>
                <h2 className="text-lg font-extrabold tracking-tight text-heading">
                  {t("lockedTitle", { stage: t(`stage_${stage}`) })}
                </h2>
                <p className="max-w-[46ch] text-sm text-mutedtext">
                  {t(`stageDesc_${stage}`)}{" "}
                  {current.waitingOn &&
                    t("waitingOn", { stage: t(`stage_${current.waitingOn}`) })}
                </p>
                <SoftButton onClick={() => setOpenAnyway(true)}>{t("unlockAnyway")}</SoftButton>
              </div>
            </Card>
          ) : (
            <>
              {stage === "idea" && (
                // Remounts when the brief is cleared, so the editor drops its copy.
                <IdeaStage
                  key={briefCleared ? "cleared" : "brief"}
                  project={project}
                  claims={claims}
                  onChanged={load}
                />
              )}

              {stage === "concepts" && (
                <Card
                  kicker={t("stage_concepts")}
                  title={t("stageTitle_concepts")}
                  intro={t("stageDesc_concepts")}
                >
                  <p className="max-w-[62ch] text-sm leading-relaxed text-body">
                    {t("conceptsBody")}
                  </p>
                  <Link
                    href="/design/drawing"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
                  >
                    {t("conceptsCta")}
                  </Link>
                </Card>
              )}

              {stage === "parts" && (
                <PartsStage
                  project={project}
                  parts={parts}
                  onChanged={load}
                  onGenerateSchematic={generateSchematic}
                />
              )}

              {stage === "design" && (
                <SchematicsStage
                  projectId={project.id}
                  parts={parts}
                  schematics={schematics}
                  onChanged={load}
                />
              )}

              {stage === "engineering" && (
                <Card
                  kicker={t("stage_engineering")}
                  title={t("stageTitle_engineering")}
                  intro={t("stageDesc_engineering")}
                >
                  <p className="max-w-[62ch] text-sm leading-relaxed text-body">
                    {t("engineeringBody")}
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <Link
                      href="/design/drawing"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
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
                </Card>
              )}

              {stage === "manufacturing" && (
                <Recommendation
                  parts={parts}
                  brief={project.brief ?? ""}
                  accepted={routeAccepted}
                  onAccept={acceptRoute}
                />
              )}

              {stage === "quote" && (
                <Card
                  kicker={t("stage_quote")}
                  title={t("stageTitle_quote")}
                  intro={t("quoteIntro")}
                >
                  <p className="text-sm text-mutedtext">
                    {t("quoteParts", {
                      confirmed: partReqs.filter((r) => r.satisfied).length,
                      total: parts.length,
                    })}
                  </p>
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
              )}

              {stage === "production" && (
                <Card
                  kicker={t("stage_production")}
                  title={t("stageTitle_production")}
                  intro={t("stageDesc_production")}
                >
                  <p className="text-sm text-mutedtext">{t("productionBody")}</p>
                </Card>
              )}

              {/* Stage footer: the one forward action. */}
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
                      onClick={() => goToStage(following)}
                      disabled={blockers.length > 0 || working}
                    >
                      {t("nextStage")}
                      <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
                    </PrimaryButton>
                  </span>
                )}
              </div>
            </>
          )}
        </main>

        {/* Assistant: honest about what it is */}
        <aside className="neu p-4">
          <div className="flex items-center justify-between gap-2">
            {!collapsed.right && (
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-bold text-heading">
                  <Sparkles className="h-4 w-4 text-cobalt" />
                  {t("assistantTitle")}
                </p>
                <p className="mt-0.5 text-[11px] text-mutedtext">{t("assistantSub")}</p>
              </div>
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
              <p className="text-xs leading-relaxed text-mutedtext">{t("assistantIntro")}</p>

              <div className="neu-inset space-y-2 p-3">
                <p className={mono("text-[9px] text-faint")}>{t("whatIcanDo")}</p>
                <ul className="space-y-1.5 text-[11.5px] text-heading">
                  {["analyse", "spec", "route", "schematic"].map((k) => (
                    <li key={k} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3 w-3 shrink-0 text-buy" />
                      {t(`cap_${k}`)}
                    </li>
                  ))}
                </ul>
                <p className="pt-1 text-[11px] leading-relaxed text-mutedtext">{t("cannotDo")}</p>
              </div>

              <div className="flex flex-col gap-2">
                <SoftButton onClick={() => goToStage("idea")} className="justify-start">
                  <Sparkles className="h-3.5 w-3.5" />
                  {t("analyse")}
                </SoftButton>
                <SoftButton onClick={() => goToStage("parts")} className="justify-start">
                  <Plus className="h-3.5 w-3.5" />
                  {t("addPart")}
                </SoftButton>
                <SoftButton onClick={() => goToStage("manufacturing")} className="justify-start">
                  <Factory className="h-3.5 w-3.5" />
                  {t("recHeading")}
                </SoftButton>
                <GhostButton onClick={() => goToStage("quote")} className="justify-start">
                  <Receipt className="h-3.5 w-3.5" />
                  {t("requestQuote")}
                </GhostButton>
              </div>

              <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-faint">
                <Cpu className="mt-0.5 h-3 w-3 shrink-0" />
                {t("nothingApplied")}
              </p>
            </div>
          )}

          {collapsed.right && (
            <div className="mt-3 flex flex-col items-center gap-2">
              <Sparkles className="h-4 w-4 text-cobalt" />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
