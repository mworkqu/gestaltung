"use client";

// The project page's header, prototyping entry and loading skeleton (split out of
// project-workspace.tsx, R8).

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { AuthReturnLink } from "@/components/auth/auth-return-link";
import { Button } from "@/components/ui/button";
import type { Project } from "@/lib/supabase/types";

export function ProjectHeader({
  project,
  guest,
  guestPhone,
  onRenamed,
}: {
  project: Project;
  guest: boolean;
  guestPhone: string | null;
  onRenamed: (name: string) => void;
}) {
  const t = useTranslations("Projects");
  const [name, setName] = useState(project.name);
  const [error, setError] = useState(false);

  async function saveName(next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === project.name) return;
    const { error: err } = await createClient()
      .from("projects")
      .update({ name: trimmed })
      .eq("id", project.id);
    setError(!!err);
    if (!err) onRenamed(trimmed);
  }

  return (
    <div className="neu space-y-4 p-6 sm:p-8">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => saveName(e.target.value)}
        aria-label={t("nameLabel")}
        className="w-full min-w-0 rounded-lg bg-transparent text-2xl font-extrabold tracking-tight text-heading outline-none focus:bg-panel focus:px-3 focus:py-1 focus:shadow-neu-inset sm:text-3xl"
      />
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {t("saveFailed")}
        </p>
      )}

      {guest && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-inventory-bg px-4 py-3">
          <Tag variant="inventory">{t("guestBadge")}</Tag>
          <p className="min-w-0 basis-full text-sm text-heading sm:flex-1 sm:basis-auto">
            {guestPhone ? t("guestPhoneNote", { phone: guestPhone }) : t("guestNote")}
          </p>
          <AuthReturnLink kind="sign-up" className="shrink-0 text-sm font-semibold text-cobalt hover:text-cobalt-hover">
            {t("signUpCta")}
          </AuthReturnLink>
        </div>
      )}
    </div>
  );
}

// ── Prototyping entry ───────────────────────────────────────────────────────
// The assisted route from a brief to a part breakdown and 2D schematics. It
// is a separate workspace (app/[locale]/projects/[id]/prototyping) rather than
// part of this page: different job, different shape, and this page has to keep
// working on its own.

export function PrototypingCard({ projectId }: { projectId: string }) {
  const t = useTranslations("Prototyping");

  return (
    <section className="neu space-y-4 p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface shadow-neu-sm">
          <Sparkles className="h-5 w-5 text-cobalt" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">{t("kicker")}</h2>
          <p className="mt-1 text-sm text-mutedtext">{t("openIntro")}</p>
        </div>
        <Button asChild>
          {/* P5-13: the Design Studio; the old workspace is the super_admin Engineer view (link inside the Studio). */}
          <Link href={`/projects/${projectId}/studio`}>{t("open")}</Link>
        </Button>
      </div>
    </section>
  );
}

/** The project page while it loads: the page's own shape in grey bars, not a bare spinner (audit #59). */
export function ProjectSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-3 w-40" />
      <div className="neu space-y-3 p-6 shadow-neu-inset sm:p-8">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="neu space-y-3 p-6 sm:p-8">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}
