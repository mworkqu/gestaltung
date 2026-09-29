"use client";

// The prototyping workspace.
//
// Reads and writes through the browser client so a guest and a signed-in
// client behave identically — RLS scopes both to their own auth.uid(), the
// same arrangement the project workspace uses. On top of RLS the project is
// read with an explicit user_id filter: this is a customer page, so even a
// super admin sees only their own projects here (audit #8, decision 6a).
//
// Three panels: the project tree on the left, the selected node in the
// middle, and the next actions on the right. Each side panel collapses — and
// starts collapsed below 1440 px unless the client chose otherwise — and the
// whole thing mirrors in Arabic because the layout is built from logical
// properties and CSS grid. The site header is hidden here; the workspace's own
// bar carries the logo, the way back and the language switch (audit #24).
//
// It opens where the client left off, or on Brief for a project that hasn't
// got past its brief (audit #32, initialNode).
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
  Factory,
  ListChecks,
  Loader2,
  Receipt,
  Send,
  ListTree,
} from "lucide-react";

import { isAuthSessionMissingError } from "@supabase/supabase-js";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { LogoMark } from "@/components/logo-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { HeaderAuthLink } from "@/components/header-auth-link";
import { CartIcon } from "@/components/parts/cart-icon";
import { CIRCUIT_FOCUS, looksLikeSchema, projectReadiness, type Requirement } from "@/lib/prototyping/readiness";
import { disciplineOf, isConcept, isMakeable } from "@/lib/prototyping/parts";
import { rowOf } from "@/lib/prototyping/spec";
import type { Spec } from "@/lib/prototyping/spec";
import { projectBoards } from "@/lib/prototyping/footprints";
import { circuitBomIds } from "@/lib/prototyping/netlist";
import {
  DESIGN_NODE,
  branches,
  initialNode,
  nodeKey,
  nodeOf,
  nodeStates,
  partNode,
  toNode,
  visibleNodes,
  withBranchChoice,
  type NodeId,
} from "@/lib/prototyping/tree";
import { nodeClick } from "@/lib/prototyping/node-click";
import type { Discipline } from "@/lib/prototyping/constants";
import {
  activeLines,
  bomCost,
  dedupeLines,
  originOf,
  viewLines,
  type BomView,
  type LineMatch,
  type ProjectBom,
} from "@/lib/prototyping/bom";
import { IdeaStage } from "@/components/prototyping/idea-stage";
import { PartsList, type StoreLine } from "@/components/prototyping/parts-list";
import { PartsStage } from "@/components/prototyping/parts-stage";
import { AddExistingDialog } from "@/components/prototyping/part-dialogs";
import { Recommendation } from "@/components/prototyping/recommendation";
import {
  SchematicsStage,
  latestReady,
  type SchematicWithRevs,
} from "@/components/prototyping/schematics-stage";
import { BomTable, CostSummary } from "@/components/prototyping/bom-table";
import { PaymentCard } from "@/components/prototyping/payment-card";
import { BuildRouteCard, LevelFlags } from "@/components/prototyping/electronics-route";
import type { BuildRoute } from "@/lib/prototyping/analysis";
import { DimensionDrawings } from "@/components/prototyping/dimension-drawings";
import { NetlistView } from "@/components/prototyping/netlist-view";
import { TreeNav } from "@/components/prototyping/tree-nav";
import { ComponentsCard, PowerCard } from "@/components/prototyping/discipline-cards";
import { Card, GhostButton, PrimaryButton, Warn, useMono } from "@/components/prototyping/ui";
import { cn } from "@/lib/utils";
import type { Project, ProjectPart, ProjectSchematicRevision } from "@/lib/supabase/types";

/** Where a part's drawings are shown. */
const drawingsNode = (p: ProjectPart): NodeId =>
  disciplineOf(p) === "electronics" ? "electronics.board" : "mechanical.drawings";

/** How many open items the side panel offers as next actions. */
const NEXT_ACTIONS = 4;

/** The client's own open/closed choice for the side panels, per browser. */
const PANELS_KEY = "gestaltung:proto-panels";
/** Where both side panels would squeeze the centre: start them collapsed. */
const NARROW = "(min-width: 1024px) and (max-width: 1439px)";

type Panels = { left: boolean; right: boolean };

function savedPanels(): Panels | null {
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null") as Partial<Panels> | null;
    return typeof v?.left === "boolean" && typeof v?.right === "boolean" ? { left: v.left, right: v.right } : null;
  } catch {
    // Storage blocked or the value is corrupt: the width rule decides instead.
    return null;
  }
}

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
  const tNav = useTranslations("Nav");
  const tBrand = useTranslations("Brand");
  const mono = useMono();
  const locale = useLocale() as Locale;
  const isRtl = locale === "ar";

  const [project, setProject] = useState<Project | null>(null);
  const [parts, setParts] = useState<ProjectPart[]>([]);
  // Store products added on the project page. Shown in the Parts list only —
  // readiness and the tree read `parts` alone.
  const [storeLines, setStoreLines] = useState<StoreLine[]>([]);
  const [storeFailed, setStoreFailed] = useState(false);
  const [schematics, setSchematics] = useState<SchematicWithRevs[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [collapsed, setCollapsed] = useState<Panels>({ left: false, right: false });
  // The open node. Chosen once per visit by initialNode; a reload after an
  // edit keeps the client where they are.
  const [current, setCurrent] = useState<string | null>(null);
  const [showOpen, setShowOpen] = useState(false);
  // Under 1024 px the project tree is a drawer behind one button (audit #54).
  const [treeOpen, setTreeOpen] = useState(false);
  const [briefCleared, setBriefCleared] = useState(false);
  const [branchSaveFailed, setBranchSaveFailed] = useState(false);
  const [specSaveFailed, setSpecSaveFailed] = useState(false);
  const [addingExisting, setAddingExisting] = useState(false);
  // Live store matches for the bill of materials, by line id (/api/bom/match).
  const [matches, setMatches] = useState<Map<string, LineMatch>>(new Map());
  const [matchState, setMatchState] = useState<"idle" | "loading" | "failed">("idle");
  const specTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadMatches = useCallback(async () => {
    setMatchState("loading");
    try {
      const res = await fetch("/api/bom/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { matches: list } = (await res.json()) as { matches: LineMatch[] };
      setMatches(new Map(list.map((m) => [m.lineId, m])));
      setMatchState("idle");
    } catch {
      setMatchState("failed");
    }
  }, [projectId]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    // A failed auth check (network, auth server) is not "sign in". getUser()
    // also reports a plain missing session as an error; that one is the
    // signed-out visitor below.
    if (authError && !isAuthSessionMissingError(authError)) {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    if (!user) {
      // No session at all (not even a guest one): nothing here can be theirs.
      setMissing(true);
      setLoading(false);
      return;
    }

    const { data: proj, error: projError } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();

    // 22P02: the id in the URL is not a uuid — the same as no such project.
    if (projError && projError.code !== "22P02") {
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    if (!proj) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setMissing(false);
    setLoadFailed(false);

    let loaded = proj as Project;
    if (looksLikeSchema(loaded.brief)) {
      // Database code was once pasted into a brief. It describes nothing, so
      // clear it and the reading that was taken from it.
      await supabase.from("projects").update({ brief: null, spec: null }).eq("id", projectId);
      loaded = { ...loaded, brief: null, spec: null };
      setBriefCleared(true);
    }
    setProject(loaded);
    if (loaded.bom?.lines?.length) void loadMatches();

    const [partRes, schRes, itemRes] = await Promise.all([
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
      supabase
        .from("project_items")
        .select("*, part:parts(*)")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
    ]);
    if (partRes.error) {
      // Without the parts every count on the page would be wrong; say so.
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const loadedParts = (partRes.data ?? []) as ProjectPart[];
    setParts(loadedParts);
    setCurrent(
      (c) =>
        c ??
        initialNode(
          { stage: loaded.stage, spec: loaded.spec, disciplines: loaded.disciplines, parts: loadedParts },
          visibleNodes(branches(loaded.disciplines, loaded.brief, loadedParts))
        )
    );
    setStoreFailed(Boolean(itemRes.error));
    setStoreLines(itemRes.error ? [] : ((itemRes.data ?? []) as StoreLine[]));

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
  }, [projectId, loadMatches]);

  useEffect(() => {
    void load();
  }, [load]);

  // A saved choice wins; otherwise both panels start collapsed where they
  // would squeeze the centre. Read after mount: the server has no window.
  useEffect(() => {
    const saved = savedPanels();
    if (saved) setCollapsed(saved);
    else if (window.matchMedia(NARROW).matches) setCollapsed({ left: true, right: true });
  }, []);

  function togglePanel(side: keyof Panels) {
    const next = { ...collapsed, [side]: !collapsed[side] };
    setCollapsed(next);
    try {
      localStorage.setItem(PANELS_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: the panel still toggles, it just isn't remembered.
    }
  }

  /** The workspace's own top bar: the site header is hidden on this page. */
  const bar = (back: React.ReactNode, rest?: React.ReactNode, below?: React.ReactNode) => (
    <header className="neu flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
      <Link href="/" aria-label={tBrand("name")} className="shrink-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ink shadow-neu-sm">
          <LogoMark title={tBrand("name")} className="h-4 w-4" gradientId="proto-logo" />
        </span>
      </Link>
      {back}
      {rest ?? <span className="flex-1" />}
      <div className="flex items-center gap-2">
        <CartIcon />
        <LanguageSwitcher currentLocale={locale} />
        <HeaderAuthLink isRtl={isRtl} />
      </div>
      {below}
    </header>
  );

  const backTo = (href: string, label: string) => (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-mutedtext transition-colors hover:text-heading"
    >
      <ArrowLeft className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
      {label}
    </Link>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {bar(backTo(`/projects/${projectId}`, t("backToProject")))}
        <div className="neu flex items-center justify-center p-16">
          <Loader2 className="h-5 w-5 animate-spin text-mutedtext" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="space-y-4">
        {bar(backTo("/projects", tProj("listHeading")))}
        <div className="neu space-y-4 p-10 text-center">
          <p className="text-base text-destructive">{t("loadFailed")}</p>
        </div>
      </div>
    );
  }

  // Not theirs, not there, or no session: one honest message (audit #8/#9).
  if (missing || !project) {
    return (
      <div className="space-y-4">
        {bar(backTo("/projects", tProj("listHeading")))}
        <div className="neu space-y-4 p-10 text-center">
          <p className="text-base text-mutedtext">{t("notAvailable")}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/sign-in"
              className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
            >
              {tNav("signIn")}
            </Link>
            <Link
              href="/projects"
              className="text-xs font-semibold text-mutedtext transition-colors hover:text-heading"
            >
              {tProj("listHeading")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const spec = project.spec ?? null;
  const routeAccepted = project.stages?.manufacturing === "complete";
  const tr = (k: string, p?: Record<string, string | number>) => t(k, p);
  const bom: ProjectBom | null = project.bom?.lines ? project.bom : null;
  const bs = branches(project.disciplines, project.brief, parts);
  const electronicsActive = bs.some((b) => b.discipline === "electronics" && b.active);
  const buildRoute = (project.build_route ?? null) as BuildRoute | null;
  const liveLines = activeLines(bom);
  const ready = projectReadiness(
    {
      brief: project.brief,
      spec,
      parts,
      routeAccepted,
      // The same boards the Parts list checks enclosures against (audit #5).
      boards: projectBoards({
        bom,
        partNames: parts.map((p) => p.name),
        itemNames: storeLines.map((l) => l.part?.name),
      }),
      bom: bom ? { lines: liveLines, matches } : null,
      electronics: electronicsActive
        ? {
            route: buildRoute,
            built: Boolean(bom?.electronicsBuiltAt) || liveLines.some((l) => originOf(l) === "electronics"),
            netlist: project.netlist ?? null,
            lineIds: liveLines.map((l) => l.id),
          }
        : null,
    },
    tr
  );
  const visible = visibleNodes(bs);
  const states = nodeStates(ready, parts, spec, visible, tr, buildRoute);
  const node = toNode(current ?? project.stage, visible);
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
    setTreeOpen(false);
    setCurrent(n);
    // Remembered so the next visit opens here (audit #32).
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
  // wins over it; re-analysing only rewrites `detected`. "restore" drops the
  // choice again — the undo of a removal (withBranchChoice).
  async function setBranch(d: Discipline, choice: boolean | "restore") {
    const before = project!.disciplines ?? null;
    const next = withBranchChoice(before, d, choice);
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

  /** Saves the client's pick for a BOM line; it survives re-analysis. */
  async function chooseProduct(lineId: string, productId: string | null) {
    if (!bom) return;
    const next: ProjectBom = {
      ...bom,
      lines: bom.lines.map((l) => (l.id === lineId ? { ...l, choice: productId } : l)),
    };
    await patchProject({ bom: next });
    await loadMatches();
  }

  /** Removes lines from the BOM (or brings them back). Rules never re-add them. */
  async function dismissLines(ids: string[], removed: boolean) {
    if (!bom) return;
    const now = new Set(bom.dismissed ?? []);
    for (const id of ids) {
      if (removed) now.add(id);
      else now.delete(id);
    }
    await patchProject({ bom: { ...bom, dismissed: [...now] } });
    await loadMatches();
  }

  /** Saves the build route; a Custom PCB also gets a board to design. */
  async function chooseRoute(r: BuildRoute): Promise<boolean> {
    const { error } = await patchProject({ build_route: r });
    if (error) {
      setProject((p) => (p ? { ...p, build_route: buildRoute } : p));
      return false;
    }
    if (r === "custom_pcb" && !designOf("electronics").length) {
      await createClient().from("project_parts").insert({
        project_id: project!.id,
        code: `P-${String(nextIndex).padStart(2, "0")}`,
        position: nextIndex,
        name: t("customPcbPart"),
        description: t("customPcbPartDesc"),
        quantity: 1,
        source: "to_design",
        kind: "electronics",
        material: "fr4",
        process: "pcb_manufacturing",
        status: "added",
      });
      await load();
    }
    return true;
  }

  // BOM lines a drawn circuit part points at: removing one would leave the
  // diagrams and the list disagreeing, so the table won't offer it.
  const inCircuit = circuitBomIds(project.netlist);

  const bomTable = (kind: BomView, before?: React.ReactNode) => {
    // The one selector for every table's lines (audit #29): same count in the
    // project BOM and the branch views.
    const { lines, dismissed } = viewLines(bom, kind, inCircuit);
    if (kind !== "all" && !lines.length && !dismissed.length && !before) return null;
    return (
      <BomTable
        projectId={project.id}
        lines={lines}
        dismissed={dismissed}
        matches={matches}
        loading={matchState === "loading"}
        failed={matchState === "failed"}
        onChoose={chooseProduct}
        onDismiss={dismissLines}
        inCircuit={inCircuit}
        kicker={kind === "all" ? t("node_bom") : t(`discipline_${kind}`)}
        title={kind === "all" ? t("bomTitle") : t(`bomTitle_${kind}`)}
        intro={kind === "all" ? t("bomIntro") : t("bomBranchIntro")}
        showTotal={kind === "all"}
        before={before}
      />
    );
  };

  const levelFlags = <LevelFlags flags={bom?.levelFlags ?? []} assumptions={bom?.assumptions ?? []} />;

  /** Earlier template drawings stay viewable; new drawings are dimension-based. */
  const earlier = (ps: ProjectPart[]) =>
    schematicsOf(ps).length > 0 && (
      <details className="neu px-4 py-3 sm:px-6">
        <summary className="cursor-pointer text-xs font-semibold text-mutedtext">{t("earlierDrawings")}</summary>
        <div className="mt-3">
          <SchematicsStage projectId={project.id} parts={parts} schematics={schematicsOf(ps)} onChanged={load} />
        </div>
      </details>
    );

  const blockers = states[node]?.open ?? [];
  const productionQty = rowOf(spec, "quantity")?.value;
  const following = visible[visible.indexOf(node) + 1] ?? null;

  /** "Concepts" alone is ambiguous across branches, so leaves name their branch (as the tree does). */
  const nodeLabel = (n: NodeId) => {
    const [d, leaf] = n.split(".");
    return leaf ? `${t(`discipline_${d}`)} · ${t(nodeKey(n))}` : t(nodeKey(n));
  };

  /** A way to the fix for a blocked node — the same target the tree's click uses. */
  const fixButton = (n: NodeId) => {
    const go = nodeClick(n, states[n], n);
    if (go.to === n) return null;
    return (
      <GhostButton onClick={() => goTo(go.to, go.focus)} className="px-1 text-cobalt hover:text-cobalt-hover">
        {t("goFix", { target: nodeLabel(go.to) })}
        <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
      </GhostButton>
    );
  };

  // The node's own reason for not going ahead, when its cause lives elsewhere
  // (audit #30): the same words the tree shows, with the way to the fix.
  const here = states[node];
  const blockedBanner = here?.reason ? (
    <Warn blocking={false} action={fixButton(node)}>
      {t("nodeBlocked", { label: nodeLabel(node), reason: here.reason })}
    </Warn>
  ) : null;

  /**
   * The Quote / Production action. One rule with the tree (audit #31): while
   * the node is blocked the button is disabled and says why beside it.
   */
  const stageAction = (n: "quote" | "production", href: string, icon: React.ReactNode, label: string) => {
    const reason = states[n]?.reason;
    if (!reason) {
      return (
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cobalt px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-cobalt-hover"
        >
          {icon}
          {label}
        </Link>
      );
    }
    return (
      <>
        <PrimaryButton disabled aria-describedby={`${n}-blocked`} className="cursor-not-allowed">
          {icon}
          {label}
        </PrimaryButton>
        <span id={`${n}-blocked`} className="text-[11px] font-medium text-inventory">
          {t("nodeBlocked", { label: t(nodeKey(n)), reason })}
        </span>
        {fixButton(n)}
      </>
    );
  };

  const designStage = (d: Discipline, view: "concepts" | "design" = "design") => (
    <PartsStage
      projectId={project.id}
      kind={d}
      view={view}
      parts={designOf(d).filter((p) => isConcept(p) === (view === "concepts"))}
      nextIndex={nextIndex}
      designNode={t(nodeKey(DESIGN_NODE[d]))}
      onChanged={load}
      onOpenDrawing={() => goTo("mechanical.drawings")}
    />
  );

  return (
    <div className="space-y-4">
      {/* Top bar */}
      {bar(
        backTo(`/projects/${project.id}`, t("backToProject")),
        <>
          <span className="hidden h-6 w-px bg-borderstrong sm:block" />
          {/* On a phone the title takes its own row so it's never cut to one letter (audit #55). */}
          <div className="order-last min-w-0 basis-full sm:order-none sm:basis-auto sm:flex-1">
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
        </>,
        showOpen && (
          <div id="readiness-open" className="neu-inset order-last w-full space-y-2 p-4">
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
        )
      )}

      <div
        className={cn(
          "grid items-start gap-4",
          collapsed.left && collapsed.right && "lg:grid-cols-[56px_minmax(0,1fr)_56px]",
          collapsed.left && !collapsed.right && "lg:grid-cols-[56px_minmax(0,1fr)_300px]",
          !collapsed.left && collapsed.right && "lg:grid-cols-[248px_minmax(0,1fr)_56px]",
          !collapsed.left && !collapsed.right && "lg:grid-cols-[248px_minmax(0,1fr)_300px]"
        )}
      >
        {/* Phones and tablets: the tree opens from one button (audit #54). */}
        <button
          type="button"
          onClick={() => setTreeOpen((o) => !o)}
          aria-expanded={treeOpen}
          aria-controls="project-tree"
          className="neu flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-heading lg:hidden"
        >
          <span className="flex items-center gap-2">
            <ListTree className="h-4 w-4 text-cobalt" />
            {t("projectSections")}
          </span>
          <ChevronDown className={cn("h-4 w-4 text-mutedtext transition-transform", treeOpen && "rotate-180")} />
        </button>

        {/* Project tree */}
        <aside id="project-tree" className={cn("neu p-3", treeOpen ? "block" : "hidden lg:block")}>
          <div className="flex items-center justify-end pb-2">
            <button
              type="button"
              onClick={() => togglePanel("left")}
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
            collapsed={collapsed.left && !treeOpen}
            saveFailed={branchSaveFailed}
            onSelect={goTo}
            onBranch={setBranch}
            onRestore={(d) => setBranch(d, "restore")}
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
          {blockedBanner}

          {node === "brief" && (
            // Remounts when the brief is cleared, so the editor drops its copy.
            <IdeaStage
              key={briefCleared ? "cleared" : "brief"}
              project={project}
              parts={parts}
              onChanged={load}
              onSpec={saveSpec}
              briefDestination={briefDestination}
            />
          )}

          {node === "parts" && (
            <PartsList
              projectId={project.id}
              parts={parts}
              storeLines={storeLines}
              storeFailed={storeFailed}
              nextIndex={nextIndex}
              onChanged={load}
              onOpen={(p) => goTo(partNode(p))}
            />
          )}

          {/* One Concepts step for every discipline, so kept-or-drop is one pass. */}
          {node === "concepts" && (
            <>
              {bs.filter((b) => b.active).map((b) => (
                <div key={b.discipline}>{designStage(b.discipline, "concepts")}</div>
              ))}
            </>
          )}

          {node === "bom" && bomTable("all")}

          {node === "mechanical.parts" && (
            <>
              {designStage("mechanical")}
              {bomTable("mechanical")}
            </>
          )}

          {node === "mechanical.drawings" && (
            <>
              <DimensionDrawings
                parts={designOf("mechanical").filter((p) => !isConcept(p))}
                onFix={(focus) => goTo("mechanical.parts", focus)}
              />
              {earlier(designOf("mechanical"))}
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
            // The same route, and the same Accept, as the Quote view — so
            // "Manufacturing route not accepted" is resolved here too (audit
            // #35) — plus each mechanical part with its material and process.
            <Recommendation
              parts={parts.filter(isMakeable)}
              brief={project.brief ?? ""}
              accepted={routeAccepted}
              onAccept={acceptRoute}
              materialsFor={designOf("mechanical").filter((p) => !isConcept(p))}
              onEditParts={() => goTo("mechanical.parts")}
            />
          )}

          {node === "electronics.board" && (
            <>
              {designStage("electronics")}
              {/* Circuit requirements focus here (readiness CIRCUIT_FOCUS). */}
              <div id={CIRCUIT_FOCUS} tabIndex={-1} className="outline-none">
                <NetlistView
                  projectId={project.id}
                  netlist={project.netlist ?? null}
                  bom={bom}
                  matches={matches}
                  onSaved={load}
                  extra={levelFlags}
                />
              </div>
              {earlier(designOf("electronics"))}
            </>
          )}

          {node === "electronics.power" && (
            <PowerCard
              spec={spec}
              netlist={project.netlist ?? null}
              onSet={() => goTo("brief", "fact-power")}
              onCircuit={() => goTo("electronics.board", CIRCUIT_FOCUS)}
            />
          )}

          {node === "electronics.components" && (
            <div id="route-card" tabIndex={-1} className="outline-none">
              <BuildRouteCard
                projectId={project.id}
                route={buildRoute}
                builtFor={(bom?.route as BuildRoute | undefined) ?? null}
                recommendation={spec?.routeRecommendation ?? null}
                onRoute={chooseRoute}
                onBuilt={load}
              />
            </div>
          )}
          {node === "electronics.components" && bomTable("electronics", levelFlags)}
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
                <PaymentCard projectId={projectId} partsQar={bomCost(dedupeLines(liveLines), matches).availableNow} />
                <div className="flex flex-wrap items-center gap-3">
                  {stageAction("quote", "/design/quote", <Receipt className="h-3.5 w-3.5" />, t("requestQuote"))}
                </div>
                <p className="text-[11px] text-mutedtext">{t("quoteNote")}</p>
              </Card>
            </>
          )}

          {node === "production" && (
            <Card kicker={t("node_production")} title={t("productionTitle")} intro={t("productionIntro")}>
              <p className="text-sm text-heading">
                {productionQty ? t("productionQty", { qty: productionQty }) : t("productionQtyUnknown")}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                {stageAction("production", "/design/upload", <Factory className="h-3.5 w-3.5" />, t("startProduction"))}
              </div>
              <p className="text-[11px] text-mutedtext">{t("productionNote")}</p>
            </Card>
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
            {following && blockers.length > 0 && (
              // Why Continue is disabled, in words beside it — not only on hover.
              <span id="continue-blocked" className="min-w-0 text-[11px] font-medium text-inventory">
                {t("continueBlocked", {
                  items: blockers.map((b) => b.blockingReason).join(" · "),
                })}
              </span>
            )}
            {following && (
              <PrimaryButton
                onClick={() => goTo(following)}
                disabled={blockers.length > 0}
                aria-describedby={blockers.length ? "continue-blocked" : undefined}
              >
                {t("continueTo", { node: t(nodeKey(following)) })}
                <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
              </PrimaryButton>
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
              onClick={() => togglePanel("right")}
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
              {liveLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => goTo("bom")}
                  className="block w-full rounded-xl bg-panel/60 p-3 text-start shadow-neu-inset transition-colors hover:ring-1 hover:ring-cobalt/30"
                >
                  <p className="mb-1.5 text-[11px] font-bold text-heading">{t("costTitle")}</p>
                  <CostSummary lines={liveLines} matches={matches} compact />
                </button>
              )}
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
