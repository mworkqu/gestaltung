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

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  Check,
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
  Ruler,
  Sparkles,
  Truck,
  Wrench,
} from "lucide-react";

import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { readiness } from "@/lib/prototyping/engine";
import {
  STAGES,
  nextStage,
  stageMap,
  type SchematicKind,
  type Stage,
  type StageStatus,
} from "@/lib/prototyping/constants";
import { Tag } from "@/components/ui/tag";
import { IdeaStage } from "@/components/prototyping/idea-stage";
import { PartsStage } from "@/components/prototyping/parts-stage";
import { Recommendation } from "@/components/prototyping/recommendation";
import {
  SchematicsStage,
  createRevision,
  type SchematicWithRevs,
} from "@/components/prototyping/schematics-stage";
import {
  Card,
  GhostButton,
  PrimaryButton,
  SoftButton,
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
    setProject(proj as Project);

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

    setClaims((claimRes.data ?? []) as ProjectClaim[]);
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

  const stages = stageMap(project.stages);
  const stage = (STAGES as readonly string[]).includes(project.stage)
    ? (project.stage as Stage)
    : "idea";
  const routeAccepted = stages.manufacturing === "complete";

  const ready = readiness({
    briefLength: (project.brief ?? "").length,
    claims,
    parts,
    routeAccepted,
    schematicsReady: schematics.filter((s) => s.revs.some((r) => r.status === "ready")).length,
    schematicsWanted: Math.max(1, Math.min(3, parts.length)),
  });

  async function patchProject(changes: Partial<Project>) {
    setProject((p) => (p ? { ...p, ...changes } : p));
    await createClient().from("projects").update(changes).eq("id", project!.id);
  }

  async function goToStage(next: Stage) {
    const map = { ...stages };
    // Visiting a stage that was waiting on you starts it.
    if (map[next] === "needs") map[next] = "progress";
    await patchProject({ stage: next, stages: map });
    await load();
  }

  async function completeStage() {
    const map = { ...stages, [stage]: "complete" as StageStatus };
    const nx = nextStage(stage);
    if (nx && map[nx] === "locked") map[nx] = "needs";
    await patchProject({ stage: nx ?? stage, stages: map });
    await load();
  }

  async function unlockStage(s: Stage) {
    await patchProject({ stage: s, stages: { ...stages, [s]: "progress" } });
    await load();
  }

  async function acceptRoute(next: boolean) {
    await patchProject({
      stages: { ...stages, manufacturing: next ? "complete" : "progress" },
    });
    await load();
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
    const map = { ...stages };
    if (map.design === "locked") map.design = "progress";
    await patchProject({ stage: "design", stages: map });
    await load();
    setWorking(false);
  }

  const stageStatus = stages[stage];
  const locked = stageStatus === "locked";
  const confirmedParts = parts.filter((p) => p.status !== "suggested").length;

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
        <div className="flex items-center gap-2">
          <span className="hidden text-[11px] text-mutedtext sm:inline">{t("readiness")}</span>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-panel shadow-neu-inset">
            <span
              className="block h-full rounded-full bg-cobalt transition-[width] duration-500"
              style={{ width: `${ready.pct}%` }}
            />
          </span>
          <b className="font-mono text-[11px] font-medium tabular-nums text-heading">
            {ready.pct}%
          </b>
        </div>
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
              const st = stages[s];
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
                            st === "complete"
                              ? "bg-buy"
                              : st === "progress"
                                ? "bg-cobalt"
                                : st === "needs"
                                  ? "bg-inventory"
                                  : "bg-faint"
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
                            st === "complete"
                              ? "text-buy"
                              : st === "progress"
                                ? "text-cobalt"
                                : st === "needs"
                                  ? "text-inventory"
                                  : "text-faint"
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
                {ready.items.map((it) => (
                  <li
                    key={it.key}
                    className={cn(
                      "flex items-center gap-2 text-[11.5px]",
                      it.value >= 1 ? "text-heading" : "text-mutedtext"
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-full",
                        it.value >= 1 ? "bg-buy-bg text-buy" : "bg-surface text-faint shadow-neu-sm"
                      )}
                    >
                      {it.value >= 1 && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="min-w-0 flex-1">{t(`ready_${it.key}`)}</span>
                    {it.total != null && (
                      <span className="font-mono text-[10px] tabular-nums text-faint">
                        {it.done}/{it.total}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {/* Active stage */}
        <main className="min-w-0 space-y-4">
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
                  {t(`stageDesc_${stage}`)} {t("lockedBody")}
                </p>
                <SoftButton onClick={() => unlockStage(stage)}>{t("unlockAnyway")}</SoftButton>
              </div>
            </Card>
          ) : (
            <>
              {stage === "idea" && (
                <IdeaStage project={project} claims={claims} onChanged={load} />
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
                    {t("quoteParts", { confirmed: confirmedParts, total: parts.length })}
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
                <span className="text-[11px] text-mutedtext">
                  {t("openItems", { count: ready.items.filter((i) => i.value < 1).length })}
                </span>
                <span className="flex-1" />
                {stageStatus === "complete" ? (
                  nextStage(stage) && (
                    <SoftButton onClick={() => goToStage(nextStage(stage)!)}>
                      {t("nextStage")}
                      <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
                    </SoftButton>
                  )
                ) : (
                  <PrimaryButton onClick={completeStage} disabled={working}>
                    <Check className="h-3.5 w-3.5" />
                    {t("markComplete")}
                  </PrimaryButton>
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

              <div className="space-y-2">
                <p className={mono("text-[9px] text-faint")}>{t("activity")}</p>
                <ul className="space-y-1.5 text-[11.5px]">
                  <li className="flex items-center gap-2 text-mutedtext">
                    <Sparkles className="h-3 w-3 text-cobalt" />
                    {claims.filter((c) => c.status === "pending").length} · {t("claimsHeading")}
                  </li>
                  <li className="flex items-center gap-2 text-mutedtext">
                    <Layers className="h-3 w-3 text-cobalt" />
                    {confirmedParts}/{parts.length} · {t("ready_parts")}
                  </li>
                  <li className="flex items-center gap-2 text-mutedtext">
                    <Ruler className="h-3 w-3 text-cobalt" />
                    {schematics.length} · {t("schHeading")}
                  </li>
                </ul>
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
              {parts.filter((p) => p.status === "suggested").length > 0 && (
                <Tag variant="neutral">{parts.filter((p) => p.status === "suggested").length}</Tag>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
