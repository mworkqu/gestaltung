"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { deriveItemStatus, type ItemStatus } from "@/lib/projects/item-status";
import { activeLines } from "@/lib/prototyping/bom";
import { ProjectPartsList } from "@/components/projects/project-parts-list";
import { projectUsesAi } from "@/lib/projects/uses-ai";
import { ProjectCadCard } from "@/components/projects/project-cad-card";
import { ProjectUnavailable } from "@/components/projects/project-unavailable";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useProjectData } from "./use-project-data";
import { ProjectHeader, PrototypingCard, ProjectSkeleton } from "./project-header";
import { BriefCard } from "./brief-card";
import { BlocksCard } from "./blocks-card";
import { ItemsCard } from "./items-card";
import { DangerZoneCard } from "./danger-zone-card";

// The project workspace: the page shell. Data: use-project-data.ts; one file per card.

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const t = useTranslations("Projects");
  const router = useRouter();
  const isRtl = useLocale() === "ar";
  const {
    project,
    setProject,
    blocks,
    items,
    cartRows,
    orderLines,
    imageUrls,
    guest,
    guestPhone,
    signedIn,
    loading,
    notFound,
    fatalError,
    partialError,
    bom,
    bomMatches,
    load,
  } = useProjectData(projectId);

  if (loading) return <ProjectSkeleton label={t("loadingProject")} />;

  if (fatalError) {
    return (
      <div role="alert" className="neu space-y-5 p-10 text-center">
        <p className="text-base text-destructive">{t("loadFailed")}</p>
        <Button asChild>
          <Link href="/projects">{t("listHeading")}</Link>
        </Button>
      </div>
    );
  }

  // Not theirs, deleted, or never existed — RLS makes these look the same, and
  // they should: a foreign project must not be confirmed to exist (audit #9).
  if (notFound || !project) {
    return (
      <div className="neu p-10 text-center">
        <ProjectUnavailable signedIn={signedIn}>
          <div className="space-y-3">
            <h1 className="text-xl font-bold text-heading">{t("notAvailableTitle")}</h1>
            <p className="mx-auto max-w-md text-base text-mutedtext">{t("notAvailableBody")}</p>
          </div>
        </ProjectUnavailable>
      </div>
    );
  }

  const statuses: Record<string, ItemStatus> = {};
  for (const item of items) {
    statuses[item.id] = deriveItemStatus({ item, cartRows, orderLines });
  }

  return (
    <div className="space-y-6">
      <nav
        aria-label={t("breadcrumbLabel")}
        className="flex flex-wrap items-center gap-1.5 text-xs text-mutedtext"
      >
        <Link href="/projects" className="hover:text-heading">
          {t("navProjects")}
        </Link>
        <ChevronRight className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} aria-hidden />
        <span aria-current="page" className="min-w-0 truncate text-heading">
          {project.name}
        </span>
      </nav>

      {partialError && (
        <p role="alert" className="rounded-xl bg-panel px-4 py-3 text-sm text-destructive shadow-neu-inset">
          {t("loadFailed")}
        </p>
      )}

      <ProjectHeader
        project={project}
        guest={guest}
        guestPhone={guestPhone}
        onRenamed={(name) => setProject((p) => (p ? { ...p, name } : p))}
      />
      {/* Drawing-only / quote projects never used the AI: no prototyping block. */}
      {projectUsesAi(project) && <PrototypingCard projectId={projectId} />}
      {/* The workspace's bill of materials, one status per line (P5-03). */}
      <ProjectPartsList projectId={projectId} bom={bom} matches={bomMatches.matches} state={bomMatches.state} />
      <BriefCard project={project} />
      <BlocksCard
        projectId={projectId}
        blocks={blocks}
        imageUrls={imageUrls}
        onChanged={load}
      />
      <ProjectCadCard projectId={projectId} />
      <ItemsCard
        projectId={projectId}
        items={items}
        statuses={statuses}
        onChanged={load}
        hasPartsList={activeLines(bom).length > 0}
      />
      <DangerZoneCard
        project={project}
        // Own-shelf units only (bought units are not "returned"), the same
        // count delete_project (0035) puts back.
        reclaimable={items.reduce((n, i) => n + (statuses[i.id]?.shelfQty ?? 0), 0)}
        onDeleted={() => router.push("/projects")}
      />
    </div>
  );
}
